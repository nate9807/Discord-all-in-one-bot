# Insane Discord Bots Project

Welcome to the **Insane Discord Bots Project**, a collection of powerful, free, and open-source Discord bots built to enhance your server experience! This repository features two standout bots: **InsaneDCBot**, an all-in-one powerhouse for moderation, music, and server management, and **Discord Modmail Bot**, a dedicated support ticket system for streamlined user assistance. Inspired by premium bots like **Bleed**, **MEE6**, and others, these tools bring professional-grade features to your community at no cost. Whether you’re managing a bustling server or providing top-tier support, we’ve got you covered.

Elevate your Discord game with the **Insane Discord Bots Project** today!

---

## InsaneDCBot

### Description
Welcome to **InsaneDCBot**, the ultimate free Discord bot that delivers premium features inspired by top-tier bots like **Bleed**, **MEE6**, **JokieMusic**, and **ServerStats**. Designed to elevate your server with powerful moderation, smooth music playback, and dynamic management tools, InsaneDCBot is your all-in-one solution for creating a thriving, organized, and entertaining community. With easy setup and endless customization, this bot is perfect for server owners who want professional-grade functionality without the price tag.

Take your Discord experience to the next level with **InsaneDCBot** today!

### ✨ Key Features
- **Moderation Tools**  
  - Commands: `ban`, `kick`, `mute`, `warn`, `purge` (delete up to 100 messages at once).  
  - Detailed moderation logs with timestamps, reasons, and moderator IDs.  
  - Temporary mutes/bans with automatic expiration.

- **Music Playback**  
  - Stream music from YouTube with commands like `play <url/search>`, `pause`, `resume`, `skip`, `stop`, `queue`.  
  - Rich embeds showing song details, progress bars, and requester info.  
  - Supports volume control and playlist queuing.

- **Auto-Moderation**  
  - Customizable bad-word filters with warn/mute/kick thresholds.  
  - Anti-spam detection to prevent message flooding.  
  - Toggleable settings per channel or server-wide.

- **Server Management**  
  - Welcome/leave messages with embeds, customizable via a `.env` file or commands.  
  - Auto-role assignment for new members (e.g., “Member” role on join).  
  - Mod-log channel setup for tracking all bot actions.

- **Reaction Roles**  
  - Create reaction role menus with up to 25 roles per message.  
  - Supports emoji-based reactions and slash-command dropdowns.  
  - Persistent role assignments even after restarts.

- **Server Stats**  
  - Display live stats like total members, online users, or role counts in voice channel names.  
  - Customizable prefixes (e.g., “Members: [count]”).  
  - Optional stat embeds for a cleaner look.

- **Join-to-Create Voice Channels**  
  - Users join a “Create VC” channel to spawn a private voice channel.  
  - Control panel with buttons to lock, rename, or delete the VC (Bleed-inspired design).  
  - Auto-deletes empty channels after a set timeout.

- **Twitch Integration**  
  - Add streamers with `twitch add <username>` and get live notifications.  
  - Customizable notification embeds with streamer status and game info.  
  - Supports multiple streamers per server.

- **Bump Reminders**  
  - Set timers to ping a role (e.g., `@Bumpers`) for server bumping (e.g., Disboard).  
  - Cooldowns to prevent spam (default: 2-hour intervals).  
  - Optional embed reminders with instructions.

- **Highly Configurable**  
  - Edit settings via a `.env` file: bot token, prefix, default channels, etc.  
  - No coding skills needed—just tweak and go!  
  - Extensible: Add new commands by dropping files into the `/commands` folder.

### 🚀 Inspired By The Best
InsaneDCBot combines the sleek moderation of **MEE6**, the dynamic voice features of **Bleed**, the music prowess of **JokieMusic**, and the stat displays of **ServerStats**—all free and open for customization.

### 🛠️ Installation
1. **Install Dependencies**  
   ```bash
   npm install
   sudo apt install certbot
   node bot.js


Setup

Create a .env file with your bot token and other settings (see sample .env.example).
Ensure Node.js v16+ is installed.
Run node bot.js to start the bot.
⚠️ Work in Progress
Actively developed—expect occasional bugs or incomplete features.
Report issues or suggest features via the Discord server!
💬 Need Help?
Discord Server: https://discord.gg/vyJYYan52Z
Contact: Add janessahellamean on Discord for direct support.
🌟 Why Choose InsaneDCBot?
Free access to premium-level tools.
Simple setup with endless customization.
Backed by a growing community of users and developers.




Discord Modmail Bot
Description
Introducing the Discord Modmail Bot, a dedicated support ticket system that transforms how your server handles user inquiries. By allowing users to DM the bot to open tickets, this bot creates organized, private ticket channels within your server for moderators to manage efficiently. With a sleek design, color-coded embeds, and support for both traditional and slash commands, it’s the perfect tool for communities that prioritize user support and streamlined moderation.

Turn chaotic DMs into a professional ticketing system with Discord Modmail Bot!

✨ Key Features
DM-to-Ticket System
Users DM the bot to open a ticket; the bot replies with a confirmation embed.
Creates a dedicated ticket channel under a “Tickets” category in your server.
Ticket IDs (e.g., ticket-001) for easy tracking.


Moderator Tools
Reply to tickets with !reply <message> or /reply <message> from the ticket channel.
Messages are relayed between the user and moderators seamlessly.
Supports attachments (images, files) in ticket replies.


Ticket Management
Close tickets with !close or /close—archives the channel and notifies the user.
Optional reason field for closing (e.g., !close Resolved).
Auto-logs closed tickets in a designated channel.


Command Flexibility
Traditional prefix commands (!) for classic users.
Modern slash commands (/) for a streamlined experience.
Help command (!help or /help) listing all features.


Custom Status
Displays “DM me for help!” as the bot’s activity status.
Always online and ready to assist.
Color-Coded Embeds
Green for ticket creation, blue for replies, red for closures.
Clean, professional formatting with timestamps and user info.


Prerequisites
Python 3.8 or higher.
A Discord Bot Token from the Discord Developer Portal.
Admin privileges on a Discord server (Guild).

cd discord-modmail-bot
pip install -r requirements.txt



Configure
Open index.py and update:
GUILD_ID = YOUR_SERVER_ID
TOKEN = YOUR_BOT_TOKEN


python index.py


💬 Need Help?
Discord Server: https://discord.gg/vyJYYan52Z
Contact: Add janessahellamean on Discord for direct support.


🌟 Why Choose Discord Modmail Bot?
Simplifies user support with an intuitive DM-to-channel system.
Lightweight and focused on ticketing excellence.
Free and open-source for anyone to use or modify.