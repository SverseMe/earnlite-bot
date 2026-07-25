import express from "express";
import cors from "cors";
import crypto from "crypto";
import Database from "better-sqlite3";
import TelegramBot from "node-telegram-bot-api";

// ====== CONFIG ======
const BOT_TOKEN = process.env.BOT_TOKEN; // from BotFather
const PORT = process.env.PORT || 3000;
const AD_REWARD = 0.02;      // $ per ad watched (adjust to real network eCPM)
const DAILY_AD_LIMIT = 15;   // ads per user per day
const REFERRAL_BONUS = 0.4;  // $ per invited friend
const MIN_WITHDRAW = 2.0;    // $ minimum withdrawal

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN env var. Set it before starting.");
  process.exit(1);
}

// ====== DB SETUP ======
const db = new Database("earnlite.db");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  telegram_id TEXT UNIQUE NOT NULL,
  username TEXT,
  balance REAL DEFAULT 0,
  total_earned REAL DEFAULT 0,
  ads_watched INTEGER DEFAULT 0,
  ads_today INTEGER DEFAULT 0,
  last_ad_date TEXT,
  referred_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY,
  telegram_id TEXT,
  amount REAL,
  method TEXT,
  destination TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ====== TELEGRAM initData VALIDATION ======
function validateInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");
  const dataCheckArr = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  const dataCheckString = dataCheckArr.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  return JSON.parse(userJson);
}

function getOrCreateUser(tgUser, referredBy) {
  let user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(String(tgUser.id));
  if (!user) {
    db.prepare(
      "INSERT INTO users (telegram_id, username, referred_by) VALUES (?, ?, ?)"
    ).run(String(tgUser.id), tgUser.username || "", referredBy || null);

    // pay referral bonus
    if (referredBy) {
      const refUser = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(referredBy);
      if (refUser) {
        db.prepare(
          "UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE telegram_id = ?"
        ).run(REFERRAL_BONUS, REFERRAL_BONUS, referredBy);
      }
    }
    user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(String(tgUser.id));
  }
  return user;
}

function resetDailyIfNeeded(user) {
  const today = new Date().toISOString().slice(0, 10);
  if (user.last_ad_date !== today) {
    db.prepare("UPDATE users SET ads_today = 0, last_ad_date = ? WHERE telegram_id = ?")
      .run(today, user.telegram_id);
    user.ads_today = 0;
    user.last_ad_date = today;
  }
  return user;
}

// ====== APP ======
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("../public"));

// Middleware: auth via Telegram initData sent in header
function auth(req, res, next) {
  const initData = req.headers["x-telegram-init-data"];
  if (!initData) return res.status(401).json({ error: "Missing initData" });
  const tgUser = validateInitData(initData);
  if (!tgUser) return res.status(401).json({ error: "Invalid initData" });
  req.tgUser = tgUser;
  next();
}

app.get("/api/me", auth, (req, res) => {
  const refParam = req.query.ref || null;
  let user = getOrCreateUser(req.tgUser, refParam);
  user = resetDailyIfNeeded(user);
  res.json({
    balance: user.balance,
    total_earned: user.total_earned,
    ads_watched: user.ads_watched,
    ads_today: user.ads_today,
    daily_limit: DAILY_AD_LIMIT,
    ad_reward: AD_REWARD,
    referral_bonus: REFERRAL_BONUS,
    min_withdraw: MIN_WITHDRAW,
  });
});

app.post("/api/watch-ad", auth, (req, res) => {
  let user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(String(req.tgUser.id));
  if (!user) return res.status(400).json({ error: "User not found, call /api/me first" });
  user = resetDailyIfNeeded(user);

  if (user.ads_today >= DAILY_AD_LIMIT) {
    return res.status(429).json({ error: "Daily ad limit reached" });
  }

  db.prepare(`
    UPDATE users SET
      balance = balance + ?,
      total_earned = total_earned + ?,
      ads_watched = ads_watched + 1,
      ads_today = ads_today + 1
    WHERE telegram_id = ?
  `).run(AD_REWARD, AD_REWARD, user.telegram_id);

  const updated = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(user.telegram_id);
  res.json({ success: true, new_balance: updated.balance, ads_today: updated.ads_today });
});

app.post("/api/withdraw", auth, (req, res) => {
  const { amount, method, destination } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(String(req.tgUser.id));
  if (!user) return res.status(400).json({ error: "User not found" });
  if (amount < MIN_WITHDRAW) return res.status(400).json({ error: `Minimum withdrawal is $${MIN_WITHDRAW}` });
  if (amount > user.balance) return res.status(400).json({ error: "Insufficient balance" });

  db.prepare("UPDATE users SET balance = balance - ? WHERE telegram_id = ?").run(amount, user.telegram_id);
  db.prepare(
    "INSERT INTO withdrawals (telegram_id, amount, method, destination) VALUES (?, ?, ?, ?)"
  ).run(user.telegram_id, amount, method, destination);

  res.json({ success: true, message: "Withdrawal requested. Processed manually within 24-48h." });
});

app.listen(PORT, () => console.log(`EarnLite backend running on port ${PORT}`));

// ====== TELEGRAM BOT (handles /start with referral links) ======
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const APP_URL = process.env.WEBAPP_URL || "https://your-app-url.com";

bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const refCode = match[1];
  const webAppUrl = refCode ? `${APP_URL}?ref=${refCode}` : APP_URL;

  bot.sendMessage(chatId, "Welcome to EarnLite! Watch ads, complete tasks, earn real rewards.", {
    reply_markup: {
      inline_keyboard: [[{ text: "Open EarnLite", web_app: { url: webAppUrl } }]],
    },
  });
});
