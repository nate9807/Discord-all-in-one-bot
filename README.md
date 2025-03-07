# Insane Discord Bots Project

Welcome to the **Insane Discord Bots Project**, a collection of powerful, free, and open-source Discord bots designed to enhance your server experience! This repository features two standout bots:

- **InsaneDCBot** – An all-in-one powerhouse for moderation, music, and server management.
- **Discord Modmail Bot** – A dedicated support ticket system for streamlined user assistance.

Inspired by premium bots like **Bleed**, **MEE6**, and others, these tools bring professional-grade features to your community at no cost. Whether you're managing a bustling server or providing top-tier support, the **Insane Discord Bots Project** has you covered!

---

## 🚀 InsaneDCBot

### 🔹 Overview
**InsaneDCBot** is the ultimate free Discord bot that delivers premium features inspired by top-tier bots like **Bleed**, **MEE6**, **JokieMusic**, and **ServerStats**. Designed to elevate your server with powerful moderation, smooth music playback, and dynamic management tools, InsaneDCBot is your all-in-one solution for creating a thriving, organized, and entertaining community. With easy setup and endless customization, this bot is perfect for server owners who want professional-grade functionality without the price tag.

### ✨ Features
#### 🛡️ Moderation Tools
- **Commands**: `ban`, `kick`, `mute`, `warn`, `purge` (delete up to 10000 messages at once).
- **Logging**: Detailed moderation logs with timestamps, reasons, and moderator IDs.
- **Temporary Actions**: Auto-expiring mutes and bans.

#### 🎵 Music Playback
- **Stream Music** from YouTube with commands like `play <url/search>`, `pause`, `resume`, `skip`, `stop`, `queue`.
- **Interactive Embeds**: Song details, progress bars, and requester info.
- **Additional Features**: Volume control and playlist queuing.

#### 🤖 Auto-Moderation
- **Customizable Filters**: Bad-word detection with warn/mute/kick thresholds.
- **Anti-Spam Protection**: Prevents message flooding.
- **Flexible Settings**: Toggle per channel or server-wide.

#### ⚙️ Server Management
- **Welcome/Leave Messages**: Customizable embed messages.
- **Auto-Roles**: Assign default roles to new members.
- **Mod-Log Channel**: Tracks all bot actions.

#### 🎭 Reaction Roles
- **Create Role Menus**: Up to 25 roles per message.
- **Supports** emoji-based reactions and dropdown menus.
- **Persistent Roles**: Roles remain after bot restarts.

#### 📊 Server Stats
- **Live Stats**: Displays total members, online users, or role counts in voice channels.
- **Customizable Formats**: E.g., "Members: [count]".
- **Optional Embed Mode**: For a cleaner look.

#### 🔊 Join-to-Create Voice Channels
- **Private VCs**: Users join a “Create VC” channel to spawn a private voice chat.
- **Control Panel**: Buttons to lock, rename, or delete VCs.
- **Auto Cleanup**: Empty channels auto-delete after a timeout.

#### 🎮 Twitch Integration
- **Live Notifications**: Get alerts when streamers go live.
- **Customizable Embeds**: Displays streamer status and game info.
- **Supports Multiple Streamers**: Add multiple Twitch accounts per server.

#### 🔔 Bump Reminders
- **Timed Alerts**: Reminds users to bump servers on platforms like Disboard.
- **Cooldown System**: Prevents excessive bumping.
- **Embed Reminders**: Provides clear instructions.

### 🛠️ Setup & Installation
#### 1️⃣ Install Dependencies
```bash
npm install
sudo apt install certbot
node bot.js
```
#### 2️⃣ Configure Settings
- Create a `.env` file with your bot token and other settings (see `.env.example`).
- Ensure Node.js v16+ is installed.
- Run the bot with `node bot.js`.

#### ⚠️ Work in Progress
This bot is actively developed—expect occasional bugs or incomplete features. Report issues or suggest features via our [Discord server](https://discord.gg/vyJYYan52Z)!
or you can add me! janessahellamean

### 🌟 Why Choose InsaneDCBot?
✅ Free access to premium-level tools.  
✅ Simple setup with endless customization.  
✅ Backed by a growing community of users and developers.  

---

## 📩 Discord Modmail Bot

### 🔹 Overview
The **Discord Modmail Bot** is a dedicated support ticket system that transforms how your server handles user inquiries. Users can DM the bot to open tickets, creating private ticket channels within your server for efficient moderation. With a sleek design, color-coded embeds, and support for both traditional and slash commands, this bot is perfect for communities that prioritize user support and streamlined moderation.

### ✨ Features
#### 📥 DM-to-Ticket System
- **User-Friendly**: Users DM the bot to open a ticket.
- **Ticket Channels**: Creates a dedicated ticket channel under a "Tickets" category.
- **Easy Tracking**: Generates ticket IDs (e.g., `ticket-001`).

#### 🎟️ Moderator Tools
- **Seamless Replies**: Use `!reply <message>` or `/reply <message>` from the ticket channel.
- **Attachment Support**: Allows images and files in ticket replies.

#### 🛑 Ticket Management
- **Close Tickets**: Use `!close` or `/close` to archive channels and notify users.
- **Reason Logging**: Optionally specify a reason (e.g., `!close Resolved`).
- **Auto-Logging**: Closed tickets are stored in a designated channel.

#### ⚙️ Command Flexibility
- **Classic Prefix Commands**: `!` for traditional users.
- **Modern Slash Commands**: `/` for easy access.
- **Help Command**: `!help` or `/help` lists all available features.

#### 🎨 Customization & Design
- **Custom Status**: Displays "DM me for help!" as the bot’s activity status.
- **Always Online**: Ready to assist at all times.
- **Color-Coded Embeds**: Green for new tickets, blue for replies, red for closures.

### 🛠️ Setup & Installation
#### 1️⃣ Prerequisites
- Python 3.8 or higher.
- A Discord Bot Token from the Discord Developer Portal.
- Admin privileges on your Discord server.

#### 2️⃣ Install Dependencies
```bash
cd discord-modmail-bot
pip install -r requirements.txt
```
#### 3️⃣ Configure Settings
- Open `index.py` and update:
  ```python
  GUILD_ID = YOUR_SERVER_ID
  TOKEN = YOUR_BOT_TOKEN
  ```
- Run the bot:
  ```bash
  python index.py
  ```

### 🌟 Why Choose Discord Modmail Bot?
✅ Simplifies user support with an intuitive DM-to-channel system.  
✅ Lightweight and focused on ticketing excellence.  
✅ Free and open-source for anyone to use or modify.  

---

## 💬 Need Help?
- **Join Our Discord Server**: [Click Here](https://discord.gg/vyJYYan52Z)
- **Contact**: Add `janessahellamean` on Discord for direct support.

🚀 Elevate your Discord server today with the **Insane Discord Bots Project**! 🎉

