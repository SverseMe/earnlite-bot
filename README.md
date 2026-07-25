# EarnLite Telegram Bot — Deploy in 10 Minutes

## 1. Deploy to Railway (free, fastest)
1. Go to https://railway.app → Sign in with GitHub
2. Create new project → "Empty Project"
3. Upload/push this whole `earnlite-bot` folder to a GitHub repo
4. In Railway: "New" → "Deploy from GitHub repo" → select your repo
5. Set **Root Directory** to `backend`
6. Add environment variables (Railway → Variables tab):
   - `BOT_TOKEN` = your token from BotFather
   - `WEBAPP_URL` = (leave blank for now, fill after first deploy)
7. Deploy. Railway gives you a live URL like `https://earnlite-production.up.railway.app`
8. Go back to Variables, set `WEBAPP_URL` to that URL, redeploy

## 2. Connect to BotFather
1. Message @BotFather → your bot → **Main App**
2. Paste your Railway URL as the Web App URL
3. Also update `botUsername` in `public/index.html` (line with `EarnLiteApp_bot`) to your real bot username

## 3. Plug in real ad network
In `public/index.html`, find:
```js
// === PLUG YOUR AD NETWORK SDK HERE ===
```
Replace the simulated timeout with your Monetag/AdsGram SDK call. Example (Monetag):
```html
<script src="https://YOUR-MONETAG-SDK-URL"></script>
```
```js
window.show_XXXXXXX().then(() => completeAdWatch());
```
Get your exact SDK snippet from your Monetag publisher dashboard after signup.

## 4. Test
- Open your bot in Telegram → /start → tap "Open EarnLite"
- Watch ad, check balance updates
- Try invite link, try withdrawal request (it just logs to DB — you approve manually for now)

## Adjust settings
Edit these constants at the top of `backend/server.js`:
- `AD_REWARD` — $ per ad (set based on real eCPM from ad network, keep below what they pay you)
- `DAILY_AD_LIMIT` — ads per user/day
- `REFERRAL_BONUS` — $ per invited friend
- `MIN_WITHDRAW` — minimum withdrawal amount

## Important
- Withdrawals are stored in the `withdrawals` table — you must pay them out manually (PayPal/crypto) and mark them paid. No auto-payout is wired up (needs PayPal Payouts API or crypto integration — ask if you want this added).
- Your profit = (ad network payout to you) − (AD_REWARD × ads watched). Keep AD_REWARD well below your real eCPM.
