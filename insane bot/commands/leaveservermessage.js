const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

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

      const previewEmbed = new EmbedBuilder()
        .setTitle('Leave Message Configured')
        .setDescription(this.generatePreview(message, interaction.member, interaction.guild, { showJoinDate, showDuration, showMemberCount }))
        .setColor(color)
        .setFooter({ text: 'Variables: {user}, {username}, {server}' })
        .setTimestamp();
      
      if (image) previewEmbed.setImage(image);

      await interaction.editReply({ 
        content: useEmbed ? undefined : this.generatePreview(message, interaction.member, interaction.guild, { showJoinDate, showDuration, showMemberCount }),
        embeds: useEmbed ? [previewEmbed] : [],
      });

    } else if (subcommand === 'preview') {
      const settings = client.settings.get(`${interaction.guild.id}:leavemessage`);
      if (!settings) {
        return interaction.editReply({ content: 'No leave message configured yet!' });
      }

      const previewEmbed = new EmbedBuilder()
        .setTitle('Leave Message Preview')
        .setDescription(this.generatePreview(settings.text, interaction.member, interaction.guild, {
          showJoinDate: settings.showJoinDate,
          showDuration: settings.showDuration,
          showMemberCount: settings.showMemberCount
        }))
        .setColor(settings.color)
        .setTimestamp();
      
      if (settings.image) previewEmbed.setImage(settings.image);

      await interaction.editReply({ 
        content: settings.useEmbed ? undefined : this.generatePreview(settings.text, interaction.member, interaction.guild, {
          showJoinDate: settings.showJoinDate,
          showDuration: settings.showDuration,
          showMemberCount: settings.showMemberCount
        }),
        embeds: settings.useEmbed ? [previewEmbed] : [],
      });

    } else if (subcommand === 'disable') {
      client.settings.delete(`${interaction.guild.id}:leavemessage`);
      await interaction.editReply({ content: 'Leave messages have been disabled!' });
    }
  },

  generatePreview(message, member, guild, options) {
    let preview = message
      .replace('{user}', `<@${member.id}>`)
      .replace('{username}', member.user.username)
      .replace('{server}', guild.name);

    if (options.showJoinDate) {
      preview += `\nJoined Server: <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`;
    }
    if (options.showDuration) {
      const durationMs = Date.now() - member.joinedTimestamp;
      const days = Math.floor(durationMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      preview += `\nMembership Duration: ${days} days, ${hours} hours`;
    }
    if (options.showMemberCount) {
      preview += `\nCurrent Members: ${guild.memberCount}`;
    }

    return preview;
  }
};