const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('joinservermessage')
    .setDescription('Configure welcome messages and settings for new members.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Set the welcome message and options')
        .addStringOption(option => 
          option.setName('message')
            .setDescription('The welcome message (use {user} for mention, {username} for name)')
            .setRequired(true))
        .addChannelOption(option => 
          option.setName('channel')
            .setDescription('The channel to send welcome messages')
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
          option.setName('show_account_age')
            .setDescription('Show account creation age? (default: true)'))
        .addBooleanOption(option => 
          option.setName('show_member_count')
            .setDescription('Show server member count? (default: true)'))
        .addStringOption(option => 
          option.setName('image')
            .setDescription('URL for welcome image'))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('preview')
        .setDescription('Preview the current welcome message'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable welcome messages')),
  category: 'Server Management',
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({ content: 'You need Manage Server permissions to configure welcome messages!' });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.SendMessages)) {
      return interaction.editReply({ content: 'I need Send Messages permissions to send welcome messages!' });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set') {
      const message = interaction.options.getString('message');
      const channel = interaction.options.getChannel('channel');
      const useEmbed = interaction.options.getBoolean('embed') ?? true;
      const color = interaction.options.getString('color') || '#00FF00';
      // Default to true unless explicitly set to false
      const showJoinDate = interaction.options.getBoolean('show_join_date') !== false; // true by default
      const showAccountAge = interaction.options.getBoolean('show_account_age') !== false; // true by default
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

      client.settings.set(`${interaction.guild.id}:joinmessage`, {
        text: message,
        channelId: channel.id,
        useEmbed,
        color,
        showJoinDate,
        showAccountAge,
        showMemberCount,
        image
      });

      const previewEmbed = new EmbedBuilder()
        .setTitle('Welcome Message Configured')
        .setDescription(this.generatePreview(message, interaction.user, interaction.guild, { showJoinDate, showAccountAge, showMemberCount }))
        .setColor(color)
        .setFooter({ text: 'Variables: {user}, {username}, {server}' })
        .setTimestamp();
      
      if (image) previewEmbed.setImage(image);

      await interaction.editReply({ 
        content: useEmbed ? undefined : this.generatePreview(message, interaction.user, interaction.guild, { showJoinDate, showAccountAge, showMemberCount }),
        embeds: useEmbed ? [previewEmbed] : [],
      });

    } else if (subcommand === 'preview') {
      const settings = client.settings.get(`${interaction.guild.id}:joinmessage`);
      if (!settings) {
        return interaction.editReply({ content: 'No welcome message configured yet!' });
      }

      const previewEmbed = new EmbedBuilder()
        .setTitle('Welcome Message Preview')
        .setDescription(this.generatePreview(settings.text, interaction.user, interaction.guild, {
          showJoinDate: settings.showJoinDate,
          showAccountAge: settings.showAccountAge,
          showMemberCount: settings.showMemberCount
        }))
        .setColor(settings.color)
        .setTimestamp();
      
      if (settings.image) previewEmbed.setImage(settings.image);

      await interaction.editReply({ 
        content: settings.useEmbed ? undefined : this.generatePreview(settings.text, interaction.user, interaction.guild, {
          showJoinDate: settings.showJoinDate,
          showAccountAge: settings.showAccountAge,
          showMemberCount: settings.showMemberCount
        }),
        embeds: settings.useEmbed ? [previewEmbed] : [],
      });

    } else if (subcommand === 'disable') {
      client.settings.delete(`${interaction.guild.id}:joinmessage`);
      await interaction.editReply({ content: 'Welcome messages have been disabled!' });
    }
  },

  generatePreview(message, user, guild, options) {
    let preview = message
      .replace('{user}', `<@${user.id}>`)
      .replace('{username}', user.username)
      .replace('{server}', guild.name);

    if (options.showJoinDate) {
      preview += `\nJoined Server: <t:${Math.floor(user.joinedTimestamp / 1000)}:R>`;
    }
    if (options.showAccountAge) {
      preview += `\nAccount Created: <t:${Math.floor(user.createdTimestamp / 1000)}:R>`;
    }
    if (options.showMemberCount) {
      preview += `\nMember #: ${guild.memberCount}`;
    }

    return preview;
  }
};