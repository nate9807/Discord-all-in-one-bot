# Discord Modmail Bot

A Discord bot that handles support tickets through direct messages and creates dedicated ticket channels in a server.

## Features
- Creates a ticket system where users can DM the bot to open a support ticket
- Automatically creates ticket channels in a designated "Tickets" category
- Allows moderators to reply to tickets using commands
- Supports both regular commands (`!`) and slash commands (`/`)
- Includes ticket closing functionality
- Custom status showing "DM me for help!"
- Color-coded embed messages for better visibility

## Prerequisites
- Python 3.8 or higher
- A Discord Bot Token from the [Discord Developer Portal](https://discord.com/developers/applications)
- A Discord Server (Guild) where you have administrative privileges

## Installation

1. Clone this repository or download the files:
```bash
cd discord-modmail-bot

Install the required dependencies: 
pip install -r requirements.txt

make sure to update the text with guild id and token in index.py