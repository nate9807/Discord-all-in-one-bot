require('dotenv').config();
const { ShardingManager, REST, Routes } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const logger = require('./utils/logger');

// Start the dashboard (index.js) and pass the ShardingManager instance
const dashboard = require('./view/index');

// Validate environment variables
if (!process.env.TOKEN) {
    logger.error('No TOKEN found in .env file. Please set it and try again.');
    process.exit(1);
}

if (!process.env.CLIENT_ID || !/^\d+$/.test(process.env.CLIENT_ID)) {
    logger.error('CLIENT_ID is missing or invalid in .env. Please set a valid Discord snowflake.');
    process.exit(1);
}

if (!process.env.WEB_PORT) {
    logger.warn('WEB_PORT not set in .env. Defaulting to 3000.');
    process.env.WEB_PORT = '3000';
}

if (!process.env.ABSOLUTE_SETTINGS_PATH) {
    logger.error('ABSOLUTE_SETTINGS_PATH not set in .env. Please set the path to settings.json.');
    process.exit(1);
}

// Shard code with explicit destroy for restart
const shardCode = `
const { Client, GatewayIntentBits, Collection, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const ytSearch = require('yt-search');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const chalk = require('chalk');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  shard: [parseInt(process.argv[2]), parseInt(process.argv[3])],
});

client.settings = new Map();
client.commands = new Collection();
client.cooldowns = new Collection();
client.spamTracker = new Map();
client.queues = new Map();

const settingsFile = process.env.ABSOLUTE_SETTINGS_PATH;
if (fs.existsSync(settingsFile)) {
  const settingsData = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  for (const [key, value] of Object.entries(settingsData)) {
    client.settings.set(key, value);
  }
  logger.info(\`Loaded settings from \${settingsFile}\`);
} else {
  logger.warn(\`Settings file not found at \${settingsFile}, starting with empty settings\`);
}

function saveSettings() {
  fs.writeFileSync(settingsFile, JSON.stringify(Object.fromEntries(client.settings), null, 2));
  logger.info(\`Saved settings to \${settingsFile}\`);
}

const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  try {
    const command = require(\`./commands/\${file}\`);
    client.commands.set(command.data.name, command);
    if (command.initialize) {
      command.initialize(client);
    }
    logger.info(\`Loaded command: \${command.data.name}\`);
  } catch (err) {
    logger.error(\`Failed to load command \${file}: \${err.message}\`);
  }
}

const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
  try {
    const event = require(\`./events/\${file}\`);
    client.on(event.name, (...args) => event.execute(...args, client));
    logger.info(\`Loaded event: \${event.name}\`);
  } catch (err) {
    logger.error(\`Failed to load event \${file}: \${err.message}\`);
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  const now = Date.now();
  const timestamps = client.cooldowns.get(command.data.name) || new Collection();
  const cooldownAmount = (command.cooldown || 3) * 1000;

  if (timestamps.has(interaction.user.id)) {
    const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
    if (now < expirationTime) {
      const timeLeft = (expirationTime - now) / 1000;
      return interaction.reply({ content: \`Please wait \${timeLeft.toFixed(1)} seconds!\`, ephemeral: true });
    }
  }

  timestamps.set(interaction.user.id, now);
  client.cooldowns.set(command.data.name, timestamps);

  try {
    logger.info(\`Executing command: \${command.data.name}\`);
    const result = await command.execute(interaction, client);
    logger.info(\`Command \${command.data.name} executed with result: \${JSON.stringify(result)}\`);
    saveSettings();
  } catch (error) {
    logger.error(\`Command \${command.data.name} failed: \${error.message}\`);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An error occurred!', ephemeral: true });
    } else if (!interaction.replied) {
      await interaction.editReply({ content: 'An error occurred!' });
    } else {
      await interaction.followUp({ content: 'An error occurred!', ephemeral: true });
    }
  }
});

client.on('guildMemberAdd', async member => {
  const guildId = member.guild.id;

  const autoroleId = client.settings.get(\`\${guildId}:autorole\`);
  if (autoroleId) {
    try {
      const role = member.guild.roles.cache.get(autoroleId);
      if (role && role.position < member.guild.members.me.roles.highest.position) {
        await member.roles.add(autoroleId);
        logger.info(\`Assigned auto-role \${role.name} to \${member.user.tag} in guild \${guildId}\`);
      } else {
        logger.warn(\`Cannot assign auto-role to \${member.user.tag} in guild \${guildId}: Role missing or above bot's highest role\`);
      }
    } catch (err) {
      logger.error(\`Failed to assign auto-role to \${member.user.tag} in guild \${guildId}: \${err.message}\`);
    }
  }

  const joinSettings = client.settings.get(\`\${guildId}:joinmessage\`);
  if (joinSettings && joinSettings.channelId) {
    const channel = member.guild.channels.cache.get(joinSettings.channelId);
    if (channel && channel.isTextBased() && channel.permissionsFor(member.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
      try {
        const joinCommand = client.commands.get('joinservermessage');
        if (!joinCommand) throw new Error('joinservermessage command not found');

        const content = joinCommand.generatePreview(joinSettings.text, member.user, member.guild, {
          showJoinDate: joinSettings.showJoinDate !== false,
          showAccountAge: joinSettings.showAccountAge !== false,
          showMemberCount: joinSettings.showMemberCount !== false,
        });

        if (joinSettings.useEmbed) {
          const embed = new EmbedBuilder()
            .setTitle('Welcome!')
            .setDescription(content)
            .setColor(joinSettings.color || '#00FF00')
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp();
          if (joinSettings.image) embed.setImage(joinSettings.image);
          await channel.send({ embeds: [embed] });
        } else {
          await channel.send({ content });
        }
        logger.info(\`Sent welcome message to \${member.user.tag} in guild \${guildId}\`);
      } catch (err) {
        logger.error(\`Failed to send welcome message to \${member.user.tag} in guild \${guildId}: \${err.message}\`);
      }
    } else {
      logger.warn(\`Invalid channel or permissions for welcome message in guild \${guildId}\`);
    }
  }
});

client.on('guildMemberRemove', async member => {
  const settings = client.settings.get(\`\${member.guild.id}:leavemessage\`);
  if (!settings || !settings.channelId) return;

  const channel = member.guild.channels.cache.get(settings.channelId);
  if (!channel || !channel.isTextBased() || !channel.permissionsFor(member.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
    logger.warn(\`Invalid channel or permissions for leave message in guild \${member.guild.id}\`);
    return;
  }

  try {
    const leaveCommand = client.commands.get('leaveservermessage');
    if (!leaveCommand) throw new Error('leaveservermessage command not found');

    const content = leaveCommand.generatePreview(settings.text, member, member.guild, {
      showJoinDate: settings.showJoinDate !== false,
      showDuration: settings.showDuration !== false,
      showMemberCount: settings.showMemberCount !== false,
    });

    if (settings.useEmbed) {
      const embed = new EmbedBuilder()
        .setTitle('Goodbye!')
        .setDescription(content)
        .setColor(settings.color || '#FF4444')
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();
      if (settings.image) embed.setImage(settings.image);
      await channel.send({ embeds: [embed] });
    } else {
      await channel.send({ content });
    }
    logger.info(\`Sent leave message for \${member.user.tag} in guild \${member.guild.id}\`);
  } catch (err) {
    logger.error(\`Failed to send leave message for \${member.user.tag} in guild \${member.guild.id}: \${err.message}\`);
  }
});

client.once('ready', () => {
  logger.info(chalk.green(\`Shard \${client.shard.ids[0]} logged in successfully with \${client.guilds.cache.size} guilds\`));
});

client.on('shardReconnecting', () => {
  logger.warn(chalk.yellow(\`Shard \${client.shard.ids[0]} is reconnecting...\`));
});

client.on('shardDisconnect', (event) => {
  logger.error(chalk.red(\`Shard \${client.shard.ids[0]} disconnected: \${event.code} - \${event.reason}\`));
});

async function getAccurateMemberCounts(guild, client) {
  let totalMembers = guild.memberCount;
  let humans = 0;
  let bots = 0;

  if (client.shard) {
    try {
      const results = await client.shard.broadcastEval(async (c, { guildId }) => {
        const g = c.guilds.cache.get(guildId);
        if (!g) return { humans: 0, bots: 0 };
        await g.members.fetch({ force: true });
        return {
          humans: g.members.cache.filter(m => !m.user.bot).size,
          bots: g.members.cache.filter(m => m.user.bot).size
        };
      }, { context: { guildId: guild.id } });
      
      humans = results.reduce((acc, val) => acc + val.humans, 0);
      bots = results.reduce((acc, val) => acc + val.bots, 0);
      
      if (humans + bots !== totalMembers) {
        logger.warn(\`Member count mismatch in guild \${guild.id}: Total=\${totalMembers}, Humans=\${humans}, Bots=\${bots}\`);
      }
    } catch (err) {
      logger.error(\`Failed to fetch member counts for guild \${guild.id}: \${err.message}\`);
      await guild.members.fetch({ force: true }).catch(e => 
        logger.error(\`Local fetch failed for guild \${guild.id}: \${e.message}\`)
      );
      humans = guild.members.cache.filter(m => !m.user.bot).size;
      bots = guild.members.cache.filter(m => m.user.bot).size;
    }
  } else {
    await guild.members.fetch({ force: true });
    humans = guild.members.cache.filter(m => !m.user.bot).size;
    bots = guild.members.cache.filter(m => m.user.bot).size;
  }

  logger.info(\`Guild \${guild.id} - Total: \${totalMembers}, Humans: \${humans}, Bots: \${bots}\`);
  return { totalMembers, humans, bots };
}

async function updateChannelName(channel, guild, stat, prefix, client) {
  let value;
  const { totalMembers, humans, bots } = await getAccurateMemberCounts(guild, client);

  switch (stat) {
    case 'totalMembers':
      value = totalMembers;
      break;
    case 'humans':
      value = humans;
      break;
    case 'bots':
      value = bots;
      break;
    case 'channels':
      value = guild.channels.cache.filter(c => c.type !== client.channels.ChannelType.GuildCategory).size;
      break;
    case 'roles':
      value = guild.roles.cache.size - 1; // Exclude @everyone
      break;
    default:
      return;
  }

  const newName = \`\${prefix}: \${value}\`;
  if (newName.length > 100) {
    logger.warn(\`Channel name \${newName} exceeds 100 characters, truncating...\`);
  }
  try {
    await channel.setName(newName.slice(0, 100));
  } catch (err) {
    logger.error(\`Failed to update channel \${channel.id} name: \${err.message}\`);
  }
}

async function updateAllStats(guild, client, trigger = 'unknown') {
  const settingsKey = \`\${guild.id}:serverstats\`;
  const settings = client.settings.get(settingsKey);
  if (!settings) return;

  if (guild._updatingStats) {
    logger.info(\`Skipped updateAllStats for guild \${guild.id} (already updating, triggered by: \${trigger})\`);
    return;
  }
  guild._updatingStats = true;

  logger.info(\`Running updateAllStats for guild \${guild.id}, triggered by: \${trigger}\`);

  try {
    for (const [channelId, { stat, prefix }] of Object.entries(settings)) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        delete settings[channelId];
        if (Object.keys(settings).length === 0) client.settings.delete(settingsKey);
        else client.settings.set(settingsKey, settings);
        continue;
      }
      await updateChannelName(channel, guild, stat, prefix, client);
    }

    if (client.shard) {
      client.shard.broadcastEval((c, { guildId, currentShardId }) => {
        if (c.shard.ids[0] !== currentShardId) {
          c.emit('message', { type: 'statsUpdate', guildId });
        }
      }, { context: { guildId: guild.id, currentShardId: client.shard.ids[0] } }).catch(err => 
        logger.error(\`Failed to broadcast stats update: \${err.message}\`)
      );
    }
  } finally {
    guild._updatingStats = false;
  }
}

logger.info(\`Shard \${process.argv[2]} attempting to login...\`);
client.login(process.env.TOKEN).catch(err => {
  logger.error(chalk.red(\`Shard \${process.argv[2]} login failed: \${err.message}\`));
  logger.error(\`Error details: \${JSON.stringify(err, null, 2)}\`);
  process.exit(1);
});

client.on('error', err => {
  logger.error(\`Shard \${client.shard.ids[0]} error: \${err.message}\`);
});
`;

const shardFilePath = path.join(__dirname, 'shard.js');

// Function to handle shard file creation/update
async function updateShardFile() {
    try {
        const currentShardCode = await fs.readFile(shardFilePath, 'utf8').catch(() => '');
        if (currentShardCode !== shardCode.trim()) {
            await fs.writeFile(shardFilePath, shardCode.trim());
            logger.info('Created/Updated shard.js successfully.');
        } else {
            logger.info('shard.js already exists and is up-to-date, skipping creation.');
        }
    } catch (err) {
        logger.error('Failed to create/update shard.js:', err);
        process.exit(1);
    }
}

// Register commands globally with deduplication
async function registerCommands() {
    const commands = new Map();
    const commandFiles = await fs.readdir(path.join(__dirname, 'commands'));
    const commandFilesFiltered = commandFiles.filter(file => file.endsWith('.js'));

    for (const file of commandFilesFiltered) {
        try {
            const command = require(`./commands/${file}`);
            if (commands.has(command.data.name)) {
                logger.warn(chalk.yellow(`Duplicate command name detected: ${command.data.name}. Skipping file: ${file}`));
                continue;
            }
            commands.set(command.data.name, command.data.toJSON());
            logger.info(chalk.green(`Loaded command for registration: ${command.data.name}`));
        } catch (err) {
            logger.error(`Failed to load command ${file}: ${err.message}`);
        }
    }

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        logger.info('Started registering application (/) commands globally.');
        const commandArray = Array.from(commands.values());
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandArray });
        logger.info(chalk.green(`Successfully registered ${commandArray.length} application (/) commands globally.`));
        logger.warn(chalk.yellow('Note: Global commands may take up to 1 hour to propagate across all servers.'));
    } catch (error) {
        logger.error('Failed to register commands globally:', error.message);
        logger.error('Error details:', JSON.stringify(error, null, 2));
    }
}

// Shard management
const manager = new ShardingManager(shardFilePath, {
    token: process.env.TOKEN,
    totalShards: 'auto',
    shardArgs: [],
    execArgv: [],
    respawn: true,
});

manager.on('shardCreate', shard => {
    logger.info(chalk.blue(`Launched shard ${shard.id}`));
    shard.on('error', err => logger.error(`Shard ${shard.id} error: ${err.message}`));
    shard.on('death', (process) => {
        logger.error(`Shard ${shard.id} died with exit code ${process.exitCode}`);
        if (!process.signal) {
            logger.warn(chalk.yellow(`Attempting to respawn shard ${shard.id}...`));
        }
    });
    shard.on('ready', () => logger.info(chalk.green(`Shard ${shard.id} is ready`)));
    shard.on('disconnect', () => logger.warn(chalk.yellow(`Shard ${shard.id} disconnected`)));
});

// Optional: Keep the message handler for debugging
manager.on('message', (shard, message) => {
    logger.info(`Received message from shard ${shard.id}: ${JSON.stringify(message)}`);
    if (message && message.type === 'restart') {
        logger.info(chalk.yellow(`Received restart command from shard ${shard.id}, initiating full restart...`));
        manager.shards.forEach(s => {
            logger.info(`Respawning shard ${s.id}...`);
            s.respawn();
        });
    }
});

// Pass the manager to the dashboard
dashboard.start(manager);

// Start the bot and register commands
async function startBot() {
    await updateShardFile();
    await registerCommands();
    
    const spawnShards = async () => {
        try {
            const shards = await manager.spawn();
            logger.info(chalk.green(`All ${shards.size} shards spawned successfully.`));
        } catch (err) {
            logger.error('Failed to spawn shards:', err);
            process.exit(1);
        }
    };

    await spawnShards();

    // Handle process signals for clean shutdowns
    process.on('SIGINT', async () => {
        logger.info('Received SIGINT, shutting down gracefully...');
        await manager.broadcastEval(c => c.destroy());
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        logger.info('Received SIGTERM, shutting down gracefully...');
        await manager.broadcastEval(c => c.destroy());
        process.exit(0);
    });
}

// Run the bot
startBot().catch(err => {
    logger.error('Bot failed to start:', err);
    process.exit(1);
});