# 🎮 TON Games — Telegram Mini App Bot

A full-featured Telegram Mini App (TMA) gaming platform built with **Python (Flask)**, **JavaScript**, **CSS**, and **HTML**. All user data is linked to Telegram via the WebApp SDK.

---

## 📁 Project Structure

```
tma_bot/
├── app.py                  # Flask backend — all API routes, game logic, DB models
├── requirements.txt        # Python dependencies
├── static/
│   ├── index.html          # Main TMA frontend (3 tabs: Games, Leaderboard, Profile)
│   ├── admin.html          # Admin panel (single-file HTML+CSS+JS)
│   ├── css/
│   │   └── styles.css      # Full styling — dark-gold luxury gaming theme
│   └── js/
│       └── app.js          # Frontend logic — games, modals, API calls, animations
└── README.md
```

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Set environment variables
```bash
export BOT_TOKEN="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
export ADMIN_CHAT_ID="YOUR_TELEGRAM_CHAT_ID"
export SECRET_KEY="your-random-secret-key"
export DATABASE_URL="sqlite:///tma_bot.db"       # or PostgreSQL URL
export BOT_WALLET_ADDRESS="UQ..."                # Your TON wallet address
```

### 3. Run the server
```bash
python app.py
# Or production:
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### 4. Deploy & host
Host on any HTTPS server (Render, Railway, VPS, etc.). Telegram Mini Apps require HTTPS.

### 5. Create Telegram Bot
1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Enable **Mini App** in bot settings
3. Set the Web App URL to your hosted domain (e.g., `https://yourdomain.com`)
4. Users open the Mini App via the bot

---

## 🎰 Games

### 1. Gift Upgrade (Roulette)
- User sets a **stake** (TON amount)
- User picks a **multiplier**: 1.3× to 20×
- The roulette wheel shows **green (win)** and **red (lose)** segments proportionally
  - 1.3× → ~76% win chance
  - 20× → ~5% win chance
- Spin animation plays, result resolves
- Last game result shown below the wheel

### 2. Rolls (Real-time)
- 100 chips: **49 Red**, **49 Blue**, **2 Green**
- Auto-spins every **10 seconds** (shared for all users)
- Users place bets on a color before each spin
- **Red / Blue → 2×**, **Green → 10×**
- Active bet is displayed under color buttons
- Mini history strip + last-100 color counts shown

### 3. Mutants (Cases)
- **Requires 5+ TON total deposited** to unlock
- **4 case types:**

| Case | Cost | Highlights |
|------|------|------------|
| Free (Daily) | 0 TON | 1× per 24h, always gives 0.05 TON, shows NFT chances |
| Regular Case | 5 TON | Jolly Chimp, 1 TON, 3.4 TON, Restless Jar, Neko Helmet |
| Artifact Case | 5 TON | Same reward pool as Regular |
| Snoop Gifts (Limited) | 7 TON | Low Rider, Cigars, King Snoop, Snoop Dog, Swag Bag, 2.2 TON |

- Case opening has a **scroll animation** with items flying past
- NFT rewards go to **Inventory**; TON rewards credit balance directly

---

## 👤 Profile & Inventory
- Shows: games played, balance, total deposited
- **Inventory grid** displays all NFT gifts
- Tap a gift → choose **Sell** (credits TON) or **Withdraw** (shows message: write "Hi + gift name" to Admin)
- **Sell All** button available

---

## 🏆 Leaderboard
- Top **35 users** by total deposits
- Rank coloring:
  - 🥇 **#1** — Gold glow
  - 🥈 **#2** — Silver
  - 🥉 **#3** — Bronze
  - **#4–7** — Blue accent
  - **#8+** — Default

---

## 🔗 Referrals
- Each user gets a unique referral link
- Referrer earns **10%** of referee's deposits (configurable per-user by admin)
- Referral balance accumulates; **withdraw to main balance when ≥ 3 TON**

---

## 💰 Deposits & Withdrawals

### Deposits
- **TON**: User gets bot wallet address + unique memo. After sending, they confirm → admin notified via Telegram message
- **Stars**: Conversion rate **100 Stars = 1.099 TON**. Instant credit.

### Withdrawals
- Minimum **10 TON**
- User enters amount + wallet address → creates pending request
- Admin receives Telegram notification
- Admin approves/rejects → user notified via bot message
- Rejected withdrawals are **auto-refunded**

---

## ⚙️ Admin Panel (`/admin`)

### Dashboard Stats
- Total users, online now (last 5 min), online in 24h, total deposited

### User Management
- Search by ID or name
- Full user profile: balance, deposits, games, refs, timestamps
- **Balance adjust**: add or subtract TON
- **Ref percent**: change per-user referral commission

### Withdrawal Approvals
- See all pending withdrawal requests
- Add optional note, approve or reject
- User is notified via Telegram

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/init` | Initialize/update user from Telegram data |
| GET | `/api/balance/:id` | Get user balance |
| POST | `/api/gift_upgrade/spin` | Spin roulette |
| GET | `/api/rolls/state` | Get Rolls game state + countdown |
| POST | `/api/rolls/bet` | Place a Rolls bet |
| POST | `/api/mutants/check` | Check if Mutants is unlocked |
| POST | `/api/mutants/open_case` | Open a case |
| GET | `/api/mutants/free_case_status` | Free case cooldown |
| GET | `/api/inventory/:id` | Get user inventory |
| POST | `/api/inventory/sell` | Sell an inventory item |
| POST | `/api/inventory/withdraw_gift` | Get withdraw instructions |
| GET | `/api/leaderboard` | Top 35 by deposits |
| GET | `/api/referrals/:id` | Get referral info |
| POST | `/api/referrals/withdraw` | Move ref balance to main |
| POST | `/api/deposit/ton` | Initiate TON deposit |
| POST | `/api/deposit/confirm` | Confirm TON deposit |
| POST | `/api/deposit/stars` | Deposit via Stars |
| POST | `/api/withdraw/create` | Create withdrawal request |
| GET | `/api/withdraw/status/:id` | Get withdrawal statuses |
| GET | `/api/admin/stats` | Global stats |
| GET | `/api/admin/user/:id` | Full user detail |
| POST | `/api/admin/user/update` | Update balance/ref% |
| POST | `/api/admin/withdrawal/:id/action` | Approve/reject withdrawal |
| GET | `/api/admin/withdrawals/pending` | All pending withdrawals |
| GET | `/api/admin/users/search` | Search users |

---

## 🛡️ Security Notes
- In production, **validate Telegram `initData`** hash before trusting user data
- Admin endpoints should be **protected** (add auth middleware)
- Use **PostgreSQL** for production instead of SQLite
- Set strong `SECRET_KEY`
- TON deposit confirmation should ideally use a **blockchain webhook** (TON Center API) rather than manual confirmation

---

## 📱 Demo Mode
The frontend works in **demo mode** without a backend — all API calls gracefully fall back to in-memory demo data so you can preview the UI locally by just opening `index.html`.
