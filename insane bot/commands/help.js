const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display detailed information about bot commands')
    .addStringOption(option => 
      option.setName('category')
        .setDescription('Specific category of commands to view')
        .setRequired(false)
        .addChoices(
          { name: '🎵 Music', value: 'music' },
          { name: '🛡️ Moderation', value: 'moderation' },
          { name: '⚙️ Server Management', value: 'server' },
          { name: '🎮 Fun', value: 'fun' },
          { name: '🔧 Utility', value: 'utility' },
          { name: '📊 Statistics', value: 'stats' }
        )),
  cooldown: 3,
  categories: {
    music: {
      emoji: '🎵',
      color: '#1DB954',
      description: 'Enhanced music commands with high-quality playback and advanced features',
      commands: [
        {
          name: 'play',
          description: 'Play music from YouTube, Spotify, or SoundCloud with advanced audio quality',
          usage: '/play <song name or URL> [quality]',
          example: '/play Never Gonna Give You Up high',
          permissions: 'None'
        },
        {
          name: 'search',
          description: 'Search for songs and select from a list of results',
          usage: '/search <query>',
          example: '/search Rickroll',
          permissions: 'None'
        },
        {
          name: 'playlist',
          description: 'Load and manage playlists from various sources',
          usage: '/playlist <action> [name]',
          example: '/playlist load favorites',
          permissions: 'None'
        },
        {
          name: 'queue',
          description: 'View and manage the current music queue with advanced controls',
          usage: '/queue [page] [action]',
          example: '/queue 2 shuffle',
          permissions: 'None'
        },
        {
          name: 'effects',
          description: 'Apply audio effects like bass boost, nightcore, or 8D audio',
          usage: '/effects <type> [level]',
          example: '/effects bassboost high',
          permissions: 'None'
        },
        {
          name: 'lyrics',
          description: 'Display synchronized lyrics for the current song',
          usage: '/lyrics [song]',
          example: '/lyrics',
          permissions: 'None'
        }
      ]
    },
    moderation: {
      emoji: '🛡️',
      color: '#FF4500',
      description: 'Advanced moderation tools to keep your server safe and organized',
      commands: [
        {
          name: 'moderate',
          description: 'Smart moderation with context-aware actions and logging',
          usage: '/moderate <user> <action> [reason] [duration]',
          example: '/moderate @user warn Spamming 24h',
          permissions: 'Moderate Members'
        },
        {
          name: 'filter',
          description: 'Set up content filters with custom rules and actions',
          usage: '/filter <action> <type> [settings]',
          example: '/filter add spam strict',
          permissions: 'Manage Server'
        },
        {
          name: 'lockdown',
          description: 'Quick channel or category lockdown with timer',
          usage: '/lockdown <target> [duration] [reason]',
          example: '/lockdown #general 1h raid',
          permissions: 'Manage Channels'
        },
        {
          name: 'case',
          description: 'View and manage moderation cases with detailed history',
          usage: '/case <action> <id>',
          example: '/case view 123',
          permissions: 'View Audit Log'
        }
      ]
    },
    server: {
      emoji: '⚙️',
      color: '#7289DA',
      description: 'Comprehensive server management and automation tools',
      commands: [
        {
          name: 'setup',
          description: 'Interactive server setup wizard for all bot features',
          usage: '/setup [module]',
          example: '/setup welcome',
          permissions: 'Manage Server'
        },
        {
          name: 'autorole',
          description: 'Advanced auto-role system with conditions and delays',
          usage: '/autorole <action> <role> [conditions]',
          example: '/autorole add @Member level:5',
          permissions: 'Manage Roles'
        },
        {
          name: 'logs',
          description: 'Configure detailed server logging with filters',
          usage: '/logs <module> <channel> [filters]',
          example: '/logs messages #logs deleted',
          permissions: 'View Audit Log'
        },
        {
          name: 'backup',
          description: 'Create and manage server backups',
          usage: '/backup <action> [name]',
          example: '/backup create weekly',
          permissions: 'Administrator'
        }
      ]
    },
    fun: {
      emoji: '🎮',
      color: '#FFD700',
      description: 'Interactive games and entertainment features',
      commands: [
        {
          name: 'minigame',
          description: 'Start various mini-games with server members',
          usage: '/minigame <type> [difficulty]',
          example: '/minigame trivia hard',
          permissions: 'None'
        },
        {
          name: 'poll',
          description: 'Create interactive polls with multiple options',
          usage: '/poll <question> <options>',
          example: '/poll "Best game?" "Minecraft,Roblox,Fortnite"',
          permissions: 'None'
        },
        {
          name: 'birthday',
          description: 'Set and celebrate member birthdays',
          usage: '/birthday <action> [date]',
          example: '/birthday set 2000-12-31',
          permissions: 'None'
        },
        {
          name: 'rank',
          description: 'View and customize your server rank card',
          usage: '/rank [user] [style]',
          example: '/rank @user neon',
          permissions: 'None'
        }
      ]
    },
    utility: {
      emoji: '🔧',
      color: '#00FFFF',
      description: 'Useful tools and utilities for server enhancement',
      commands: [
        {
          name: 'remind',
          description: 'Set smart reminders with natural language processing',
          usage: '/remind <time> <message>',
          example: '/remind 2h water plants',
          permissions: 'None'
        },
        {
          name: 'tag',
          description: 'Create and manage custom command shortcuts',
          usage: '/tag <action> <name> [content]',
          example: '/tag create rules Our server rules...',
          permissions: 'None'
        },
        {
          name: 'embed',
          description: 'Create beautiful embedded messages with a visual editor',
          usage: '/embed <action> [template]',
          example: '/embed create announcement',
          permissions: 'Manage Messages'
        },
        {
          name: 'translate',
          description: 'Translate messages between languages',
          usage: '/translate <text> <language>',
          example: '/translate bonjour english',
          permissions: 'None'
        }
      ]
    },
    stats: {
      emoji: '📊',
      color: '#4CAF50',
      description: 'Detailed statistics and analytics for your server',
      commands: [
        {
          name: 'serverstats',
          description: 'View comprehensive server statistics and growth',
          usage: '/serverstats [timeframe]',
          example: '/serverstats monthly',
          permissions: 'None'
        },
        {
          name: 'activity',
          description: 'Track member activity and engagement',
          usage: '/activity [user] [period]',
          example: '/activity @user week',
          permissions: 'None'
        },
        {
          name: 'leaderboard',
          description: 'Display server leaderboards for various metrics',
          usage: '/leaderboard <type> [page]',
          example: '/leaderboard messages',
          permissions: 'None'
        },
        {
          name: 'insights',
          description: 'Get AI-powered insights about server trends',
          usage: '/insights [focus]',
          example: '/insights engagement',
          permissions: 'Manage Server'
        }
      ]
    }
  },
  
  async execute(interaction, client) {
    try {
      const category = interaction.options.getString('category');
      
      if (category) {
        // Show specific category
        await this.displayCategory(interaction, client, category);
      } else {
        // Show main help menu
        await this.displayMainHelp(interaction, client);
      }
      
      logger.info(`Help command executed by ${interaction.user.tag} in guild ${interaction.guild.id}`);
    } catch (error) {
      logger.error(`Error in help command: ${error}`);
      await interaction.reply({ 
        content: 'An error occurred while displaying help. Please try again later.',
        ephemeral: true 
      });
    }
  },
  
  async displayMainHelp(interaction, client) {
    const embed = new EmbedBuilder()
      .setTitle(`${client.user.username} Help Menu`)
      .setDescription('Welcome to the help menu! Select a category below or use the dropdown menu to view specific commands.')
      .setColor('#5865F2')
      .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        Object.entries(this.categories).map(([key, category]) => ({
          name: `${category.emoji} ${key.charAt(0).toUpperCase() + key.slice(1)} Commands`,
          value: `${category.description}\n*${category.commands.length} commands available*`,
          inline: false
        }))
      )
      .setTimestamp()
      .setFooter({ 
        text: `Type /help <category> for detailed information • ${client.user.username}`, 
        iconURL: interaction.user.displayAvatarURL({ dynamic: true }) 
      });
    
    // Create dropdown for categories
    const row = new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('help_category_select')
          .setPlaceholder('Select a category...')
          .addOptions(
            Object.entries(this.categories).map(([key, category]) => ({
              label: `${key.charAt(0).toUpperCase() + key.slice(1)} Commands`,
              description: category.description.slice(0, 100),
              value: key,
              emoji: category.emoji
            }))
          )
      );
    
    const response = {
      embeds: [embed],
      components: [row],
      ephemeral: false
    };

    if (interaction.deferred) {
      await interaction.editReply(response);
    } else {
      await interaction.reply(response);
    }
  },
  
  async displayCategory(interaction, client, categoryKey) {
    const category = this.categories[categoryKey];
    
    if (!category) {
      const response = {
        content: `Invalid category: ${categoryKey}`,
        embeds: [],
        components: [],
        ephemeral: true
      };
      
      if (interaction.deferred) {
        return await interaction.editReply(response);
      }
      return await interaction.reply(response);
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`${category.emoji} ${categoryKey.charAt(0).toUpperCase() + categoryKey.slice(1)} Commands`)
      .setDescription(category.description)
      .setColor(category.color)
      .setTimestamp()
      .setFooter({ 
        text: `Type /help for all categories • ${client.user.username}`, 
        iconURL: interaction.user.displayAvatarURL({ dynamic: true }) 
      });
    
    // Add commands to the embed
    category.commands.forEach(cmd => {
      embed.addFields({
        name: `/${cmd.name}`,
        value: `📝 **Description:** ${cmd.description}\n` +
               `🔧 **Usage:** \`${cmd.usage}\`\n` +
               `💡 **Example:** \`${cmd.example}\`\n` +
               `🔒 **Required Permissions:** ${cmd.permissions}`,
        inline: false
      });
    });
    
    // Create button to go back to main help
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('help_main_menu')
          .setLabel('Back to Main Menu')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('⬅️')
      );

    const response = { 
      embeds: [embed], 
      components: [row],
      ephemeral: false
    };

    if (interaction.deferred) {
      await interaction.editReply(response);
    } else {
      await interaction.reply(response);
    }
  },

  // Handle component interactions
  async handleInteraction(interaction, client) {
    try {
      if (interaction.isStringSelectMenu() && interaction.customId === 'help_category_select') {
        const categoryKey = interaction.values[0];
        await this.displayCategory(interaction, client, categoryKey);
      } else if (interaction.isButton() && interaction.customId === 'help_main_menu') {
        await this.displayMainHelp(interaction, client);
      }
    } catch (error) {
      logger.error(`Error handling help interaction: ${error}`);
      const response = {
        content: 'An error occurred while updating the help menu. Please try again.',
        ephemeral: true
      };
      
      if (interaction.deferred) {
        await interaction.editReply(response);
      } else {
        await interaction.reply(response);
      }
    }
  }
};