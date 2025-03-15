require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./utils/logger');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Collection to store commands
client.commands = new Collection();
client.queues = new Collection(); // For managing voice queues

// Load the command
async function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = await fs.readdir(commandsPath);

  for (const file of commandFiles) {
    if (file.endsWith('.js')) {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);
      client.commands.set(command.data.name, command);
      logger.info(`Loaded command: ${command.data.name}`);
    }
  }
}

// Register commands and handle interactions
client.once('ready', async () => {
  logger.info(`Logged in as ${client.user.tag}`);
  await loadCommands();

  // Register slash commands globally (or use guild-specific for testing)
  try {
    await client.application.commands.set(client.commands.map(cmd => cmd.data.toJSON()));
    logger.info('Registered slash commands globally');
  } catch (error) {
    logger.error('Failed to register slash commands:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, client);
  } catch (error) {
    logger.error(`Error executing command ${interaction.commandName}:`, error);
    await interaction.reply({ content: 'There was an error executing that command!', ephemeral: true });
  }
});

// Handle process termination
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down...');
  client.destroy();
  process.exit(0);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN_SABATON).catch(error => {
  logger.error('Failed to login:', error);
  process.exit(1);
});