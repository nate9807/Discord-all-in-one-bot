const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ChannelType 
  } = require('discord.js');
  
  // Fallback to console if logger isn't available
  let logger;
  try {
    logger = require('../utils/logger');
  } catch (err) {
    console.warn('Logger module not found, using console instead');
    logger = console;
  }
  
  // Debounce map to limit updates per guild
  const lastUpdate = new Map();
  
  const serverStats = {
    data: new SlashCommandBuilder()
      .setName('setupserverstats')
      .setDescription('Set up channels to display server stats via their names.')
      .addSubcommand(subcommand =>
        subcommand
          .setName('add')
          .setDescription('Add a channel to display a stat.')
          .addChannelOption(option => 
            option.setName('channel')
              .setDescription('Channel to rename with a stat')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText))
          .addStringOption(option => 
            option.setName('stat')
              .setDescription('Stat to display in the channel name')
              .setRequired(true)
              .addChoices(
                { name: 'Total Members', value: 'totalMembers' },
                { name: 'Humans', value: 'humans' },
                { name: 'Bots', value: 'bots' },
                { name: 'Roles', value: 'roles' }
              ))
          .addStringOption(option => 
            option.setName('prefix')
              .setDescription('Prefix for the channel name (e.g., "👥 Members")')
              .setRequired(false)))
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove')
          .setDescription('Remove a stat channel.')
          .addChannelOption(option => 
            option.setName('channel')
              .setDescription('Channel to stop renaming')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText))),
    cooldown: 10,
    async execute(interaction, client) {
      await interaction.deferReply({ ephemeral: true });
  
      // Permission checks
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.editReply({ content: 'You need Manage Server permission!' });
      }
      const botMember = interaction.guild.members.me;
      if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.editReply({ content: 'I need Manage Channels permission!' });
      }
  
      const subcommand = interaction.options.getSubcommand();
      const settingsKey = `${interaction.guild.id}:serverstats`;
      let settings = client.settings.get(settingsKey) || {};
  
      if (subcommand === 'add') {
        const channel = interaction.options.getChannel('channel');
        const stat = interaction.options.getString('stat');
        const prefix = interaction.options.getString('prefix') || stat.charAt(0).toUpperCase() + stat.slice(1);
  
        if (!channel.permissionsFor(botMember).has(PermissionFlagsBits.ManageChannels)) {
          return interaction.editReply({ content: `I need Manage Channels permission in ${channel}!` });
        }
  
        settings[channel.id] = { stat, prefix };
        client.settings.set(settingsKey, settings);
  
        await updateChannelName(channel, interaction.guild, stat, prefix, client);
        logger.info(`Added stat channel ${channel.id} for ${stat} in guild ${interaction.guild.id}`);
        await interaction.editReply({ content: `Set ${channel} to display ${stat}!` });
      } else if (subcommand === 'remove') {
        const channel = interaction.options.getChannel('channel');
  
        if (!settings[channel.id]) {
          return interaction.editReply({ content: `${channel} is not set up as a stat channel!` });
        }
  
        delete settings[channel.id];
        if (Object.keys(settings).length === 0) {
          client.settings.delete(settingsKey);
        } else {
          client.settings.set(settingsKey, settings);
        }
  
        await channel.setName(channel.name.split(':')[0] || channel.name).catch(err => 
          logger.error(`Failed to reset channel name ${channel.id}: ${err.message}`)
        );
        logger.info(`Removed stat channel ${channel.id} in guild ${interaction.guild.id}`);
        await interaction.editReply({ content: `Removed stat display from ${channel}!` });
      }
    },
    
    initialize(client) {
      logger.info('Initializing server stats listeners...');
  
      // Event listeners for real-time updates
      client.on('guildMemberAdd', async member => {
        await updateAllStats(member.guild, client, 'guildMemberAdd');
      });
  
      client.on('guildMemberRemove', async member => {
        await updateAllStats(member.guild, client, 'guildMemberRemove');
      });
  
      client.on('channelCreate', async channel => {
        if (channel.guild) await updateAllStats(channel.guild, client, 'channelCreate');
      });
  
      client.on('channelDelete', async channel => {
        if (channel.guild) await updateAllStats(channel.guild, client, 'channelDelete');
      });
  
      client.on('roleCreate', async role => {
        await updateAllStats(role.guild, client, 'roleCreate');
      });
  
      client.on('roleDelete', async role => {
        await updateAllStats(role.guild, client, 'roleDelete');
      });
  
      // Periodic update every 30 minutes for large servers
      setInterval(async () => {
        logger.info('Running periodic server stats update');
        for (const guild of client.guilds.cache.values()) {
          try {
            await updateAllStats(guild, client, 'periodic');
          } catch (err) {
            logger.error(`Failed to update stats for guild ${guild.id}: ${err.message}`);
          }
        }
      }, 30 * 60 * 1000); // 30 minutes in milliseconds
    }
  };
  
  // Helper function to fetch accurate member counts across shards
  async function getAccurateMemberCounts(guild, client) {
    let totalMembers = guild.memberCount;
    let humans = 0;
    let bots = 0;
  
    if (client.shard) {
      try {
        const results = await client.shard.broadcastEval(async (c, { guildId }) => {
          const g = c.guilds.cache.get(guildId);
          if (!g) return { humans: 0, bots: 0 };
          await g.members.fetch({ force: true }); // Force fetch to ensure cache is updated
          return {
            humans: g.members.cache.filter(m => !m.user.bot).size,
            bots: g.members.cache.filter(m => m.user.bot).size
          };
        }, { context: { guildId: guild.id } });
        
        humans = results.reduce((acc, val) => acc + val.humans, 0);
        bots = results.reduce((acc, val) => acc + val.bots, 0);
        
        // Validate against totalMembers
        if (humans + bots !== totalMembers) {
          logger.warn(`Member count mismatch in guild ${guild.id}: Total=${totalMembers}, Humans=${humans}, Bots=${bots}`);
        }
      } catch (err) {
        logger.error(`Failed to fetch member counts for guild ${guild.id}: ${err.message}`);
        // Fallback: Fetch locally
        await guild.members.fetch({ force: true }).catch(e => 
          logger.error(`Local fetch failed for guild ${guild.id}: ${e.message}`)
        );
        humans = guild.members.cache.filter(m => !m.user.bot).size;
        bots = guild.members.cache.filter(m => m.user.bot).size;
      }
    } else {
      await guild.members.fetch({ force: true });
      humans = guild.members.cache.filter(m => !m.user.bot).size;
      bots = guild.members.cache.filter(m => m.user.bot).size;
    }
  
    logger.info(`Guild ${guild.id} - Total: ${totalMembers}, Humans: ${humans}, Bots: ${bots}`);
    return { totalMembers, humans, bots };
  }
  
  // Helper function to update a single channel name
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
      case 'roles':
        value = guild.roles.cache.size - 1; // Exclude @everyone
        break;
      default:
        return;
    }
  
    const newName = `${prefix}: ${value}`;
    if (newName.length > 100) {
      logger.warn(`Channel name ${newName} exceeds 100 characters, truncating...`);
    }
    try {
      await channel.setName(newName.slice(0, 100));
    } catch (err) {
      logger.error(`Failed to update channel ${channel.id} name: ${err.message}`);
    }
  }
  
  // Helper function to update all stat channels in a guild with debounce
  async function updateAllStats(guild, client, source = 'unknown') {
    const now = Date.now();
    const last = lastUpdate.get(guild.id) || 0;
    if (now - last < 5000) return; // Debounce: 5 seconds
    lastUpdate.set(guild.id, now);
  
    const settingsKey = `${guild.id}:serverstats`;
    const settings = client.settings.get(settingsKey);
    if (!settings) return;
  
    const { totalMembers, humans, bots } = await getAccurateMemberCounts(guild, client);
  
    for (const [channelId, { stat, prefix }] of Object.entries(settings)) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        delete settings[channelId];
        if (Object.keys(settings).length === 0) client.settings.delete(settingsKey);
        else client.settings.set(settingsKey, settings);
        continue;
      }
      let value;
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
        case 'roles':
          value = guild.roles.cache.size - 1; // Exclude @everyone
          break;
        default:
          continue;
      }
      const newName = `${prefix}: ${value}`.slice(0, 100);
      try {
        await channel.setName(newName);
      } catch (err) {
        logger.error(`Failed to update channel ${channel.id} name: ${err.message}`);
      }
    }
  }
  
  module.exports = serverStats;