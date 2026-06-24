# 🎀 Helper Joko - Blox Fruits Ticket & WhatsApp Helper Bot

A powerful, self-hosted system integrating a **Discord Ticket Bot** (with a highly aesthetic Melody/Anime layout), a **WhatsApp Helper Bot** (running on your personal number), an **AI Agent (Joko)** using Google Gemini (trained on Blox Fruits Wiki and responding in funny Jakarta TikTok slang), and a **Premium Web Dashboard** for configuration and live WhatsApp QR pairing.

---

## 🌟 Key Features

1. **Aesthetic Discord Ticket Desk**: Beautiful embed layouts with custom lines, heart markers, and button triggers to open private channels.
2. **TikTok Slang AI Joko**: AI agent dynamically responds to tickets using Indonesian-English Jakarta slang (e.g. *literally*, *bro*, *ngl*, *lo-gue*, *anjir*).
3. **Age-Restricted Language Filter**: Detects if a user has a `<15` role and automatically forces the AI into **Polite Casual Mode** (filtering out edgy slang words). Users can toggle their preference with `/bahasa`.
4. **Natural AI Pricing Trigger (`ai ` Prefix)**: Customers can get pricing quotes by typing naturally (e.g., `ai hitung level 100 ke 1500 + godhuman`). The AI programmatically calls our database calculator to give exact, exploit-safe quotes.
5. **Staff-Only Commands**: Slash command `/hitung-joki` is restricted to admins/workers inside staff channels as a backup calculator.
6. **WhatsApp Bridge Notifications**: WhatsApp alerts the admin on their own number when a new ticket is opened. Admin can reply directly from WhatsApp using `.r [ticketId] [reply]`.
7. **Premium Web Dashboard**: A glassmorphism dashboard to scan the WhatsApp Web QR code, edit joki pricelists, test calculations, and stream live terminal logs.

---

## 🚀 Getting Started

### 📋 Prerequisites
- **Node.js** (v18 or newer recommended)
- **Discord Bot Token** and Guild ID (from Discord Developer Portal)
- **Gemini API Key** (from Google AI Studio - Free tier available)

### 🛠️ Installation Steps

1. **Install Node Modules**:
   ```bash
   npm install
   ```

2. **Setup Environment Variables**:
   Open `.env` in the root folder and input your credentials:
   - `DISCORD_TOKEN`: Your bot token.
   - `DISCORD_GUILD_ID`: Your target Discord server ID.
   - `GEMINI_API_KEY`: Your Google Gemini key.

3. **Initialize SQLite Database & Seeding**:
   Setup the SQLite schema and seed the initial joki pricelist items (leveling, Godhuman, CDK, Soul Guitar, Sanguine, and Raids):
   ```bash
   npm run db:init
   ```

4. **Run in Development**:
   ```bash
   npm run dev
   ```

5. **Access Dashboard**:
   Open **[http://localhost:3000](http://localhost:3000)** in your browser.
   - Go to **WhatsApp pairing** tab and scan the QR code using your WhatsApp app (Linked Devices) to connect your personal number.
   - Go to **Status & Config** and double-check your Discord and Gemini setups.
   - Setup your ticket panels in Discord by running `/setup-panel` inside the target ticket channel (requires admin/staff role)!

---

## ⚙️ Running in Production (VPS)
To ensure the bot runs 24/7 in the background of your VPS:
```bash
npm install -g pm2
pm2 start src/index.js --name "helper-joko"
pm2 save
pm2 startup
```

## 🔒 Security & Exploit Safeguards
The bot includes a security audit layer (`src/utils/securityAudit.js`):
- **Jailbreak Blocker**: Automatically rejects message commands that try to inject prompts (e.g. *"ignore previous instructions"*).
- **Calculator Sandbox**: Sanitizes parameters, preventing overflow target levels (>2550) or negative numbers to alter prices.
- **Role Limits**: Public commands block users marked with minor roles from enabling harsh slang.
