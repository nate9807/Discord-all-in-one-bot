const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../utils/logger');
const moment = require('moment');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaveservermessage')
    .setDescription('Configure leave messages and settings for departing members.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set the leave message and options')
        .addStringOption(option => 
          option.setName('message')
            .setDescription('The leave message (use {user} for mention, {username} for name)')
            .setRequired(true))
        .addChannelOption(option => 
          option.setName('channel')
            .setDescription('The channel to send leave messages')
            .setRequired(true))
        .addBooleanOption(option => 
          option.setName('embed')
            .setDescription('Send as an embed? (default: true)'))
        .addStringOption(option => 
          option.setName('color')
            .setDescription('Embed color in hex (e.g., #FF0000)'))
        .addBooleanOption(option => 
          option.setName('show_join_date')
            .setDescription('Show user join date? (default: true)'))
        .addBooleanOption(option => 
          option.setName('show_duration')
            .setDescription('Show how long they were a member? (default: true)'))
        .addBooleanOption(option => 
          option.setName('show_member_count')
            .setDescription('Show server member count? (default: true)'))
        .addStringOption(option => 
          option.setName('image')
            .setDescription('URL for leave image'))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('preview')
        .setDescription('Preview the current leave message'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable leave messages')),
  category: 'Server Management',
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({ content: 'You need Manage Server permissions to configure leave messages!' });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.SendMessages)) {
      return interaction.editReply({ content: 'I need Send Messages permissions to send leave messages!' });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'set') {
        const message = interaction.options.getString('message');
        const channel = interaction.options.getChannel('channel');
        const useEmbed = interaction.options.getBoolean('embed') ?? true;
        const color = interaction.options.getString('color') || '#FF4500'; // Default to orange-red for leave
        // Default to true unless explicitly set to false
        const showJoinDate = interaction.options.getBoolean('show_join_date') !== false; // true by default
        const showDuration = interaction.options.getBoolean('show_duration') !== false; // true by default
        const showMemberCount = interaction.options.getBoolean('show_member_count') !== false; // true by default
        const image = interaction.options.getString('image');

        if (!channel.isTextBased() || channel.type === ChannelType.GuildVoice) {
          return interaction.editReply({ content: 'Please select a text-based channel!' });
        }
        if (color && !/^#[0-9A-F]{6}$/i.test(color)) {
          return interaction.editReply({ content: 'Invalid hex color! Use format #RRGGBB (e.g., #FF0000)' });
        }
        if (image && !image.match(/^https?:\/\/.*\.(png|jpg|jpeg|gif)$/i)) {
          return interaction.editReply({ content: 'Invalid image URL! Must be a direct link to a PNG/JPG/GIF' });
        }

        // Save settings
        client.settings.set(`${interaction.guild.id}:leavemessage`, {
          text: message,
          channelId: channel.id,
          useEmbed,
          color,
          showJoinDate,
          showDuration,
          showMemberCount,
          image
        });

        // Save to file
        await client.saveSettings();

        const previewEmbed = new EmbedBuilder()
          .setTitle('Leave Message Configured')
          .setDescription(this.generatePreview(message, interaction.user, interaction.guild, { showJoinDate, showDuration, showMemberCount }))
          .setColor(color)
          .setFooter({ text: 'Variables: {user}, {username}, {server}' })
          .setTimestamp();
        
        if (image) previewEmbed.setImage(image);

        await interaction.editReply({ 
          content: useEmbed ? undefined : this.generatePreview(message, interaction.user, interaction.guild, { showJoinDate, showDuration, showMemberCount }),
          embeds: useEmbed ? [previewEmbed] : [],
        });

        // Send test message to leave channel
        const testEmbed = new EmbedBuilder()
          .setTitle('Leave Message Test')
          .setDescription('✅ This channel has been set as the leave messages channel. Member departures will be announced here.')
          .setColor('#00FFFF')
          .setTimestamp();

        await channel.send({ embeds: [testEmbed] });
        logger.info(`Leave message configured for guild ${interaction.guild.id} in channel ${channel.id}`);

      } else if (subcommand === 'preview') {
        const settings = client.settings.get(`${interaction.guild.id}:leavemessage`);
        if (!settings) {
          return interaction.editReply({ content: 'No leave message configured yet!' });
        }

        const previewEmbed = new EmbedBuilder()
          .setTitle('Leave Message Preview')
          .setDescription(this.generatePreview(settings.text, interaction.user, interaction.guild, {
            showJoinDate: settings.showJoinDate,
            showDuration: settings.showDuration,
            showMemberCount: settings.showMemberCount
          }))
          .setColor(settings.color)
          .setTimestamp();
        
        if (settings.image) previewEmbed.setImage(settings.image);

        await interaction.editReply({ 
          content: settings.useEmbed ? undefined : this.generatePreview(settings.text, interaction.user, interaction.guild, {
            showJoinDate: settings.showJoinDate,
            showDuration: settings.showDuration,
            showMemberCount: settings.showMemberCount
          }),
          embeds: settings.useEmbed ? [previewEmbed] : [],
        });

      } else if (subcommand === 'disable') {
        client.settings.delete(`${interaction.guild.id}:leavemessage`);
        // Save to file after disabling
        await client.saveSettings();
        await interaction.editReply({ content: 'Leave messages have been disabled!' });
        logger.info(`Leave messages disabled for guild ${interaction.guild.id}`);
      }
    } catch (error) {
      logger.error(`Error in leaveservermessage command for guild ${interaction.guild.id}:`, error);
      await interaction.editReply({ 
        content: 'An error occurred while configuring leave messages. Please try again.',
        ephemeral: true 
      });
    }
  },

  generatePreview(message, user, guild, options) {
    const timestamp = Math.floor(Date.now() / 1000);
    const joinedAt = user.joinedTimestamp ? Math.floor(user.joinedTimestamp / 1000) : timestamp;
    const memberCount = Math.max(0, guild.memberCount - 1); // Simulate member leaving

    // Replace basic variables
    let preview = message
      .replace(/{user}/g, `<@${user.id}>`)
      .replace(/{username}/g, user.username)
      .replace(/{server}/g, guild.name)
      .replace(/{membercount}/g, memberCount.toLocaleString())
      .replace(/{servername}/g, guild.name)
      .replace(/{position}/g, memberCount.toLocaleString());

    // Add additional info if enabled
    let additionalInfo = [];

    if (options.showJoinDate) {
      additionalInfo.push(`📅 **First Joined:** <t:${joinedAt}:F> (<t:${joinedAt}:R>)`);
    }

    if (options.showDuration) {
      const duration = Math.max(0, timestamp - joinedAt);
      const days = Math.floor(duration / 86400);
      const months = Math.floor(days / 30);
      const years = Math.floor(months / 12);

      let timeString = '';
      if (years > 0) {
        timeString = `${years} year${years > 1 ? 's' : ''}`;
      } else if (months > 0) {
        timeString = `${months} month${months > 1 ? 's' : ''}`;
      } else if (days > 0) {
        timeString = `${days} day${days > 1 ? 's' : ''}`;
      } else {
        timeString = 'less than a day';
      }

      additionalInfo.push(`⏱️ **Time as Member:** ${timeString}`);
    }

    if (options.showMemberCount) {
      additionalInfo.push(`👥 **Members Remaining:** ${memberCount.toLocaleString()}`);
    }

    // Add additional info if there are any
    if (additionalInfo.length > 0) {
      preview += '\n\n' + additionalInfo.join('\n');
    }

    return preview;
  }
};