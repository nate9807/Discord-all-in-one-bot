const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send an announcement to a specified channel.')
    .addStringOption(option => 
      option.setName('message')
        .setDescription('The announcement message')
        .setRequired(true))
    .addChannelOption(option => 
      option.setName('channel')
        .setDescription('The channel to send the announcement to')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(option => 
      option.setName('title')
        .setDescription('Custom title for the announcement (optional)')
        .setRequired(false))
    .addStringOption(option => 
      option.setName('color')
        .setDescription('Embed color in hex (e.g., #FF0000) (optional)')
        .setRequired(false))
    .addBooleanOption(option => 
      option.setName('ping')
        .setDescription('Whether to ping @everyone (default: true)')
        .setRequired(false)),
  cooldown: 5,
  async execute(interaction, client) {
    // Check permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ 
        content: 'You need Administrator permissions to use this command!', 
        ephemeral: true 
      });
    }

    // Get options
    const message = interaction.options.getString('message');
    const channel = interaction.options.getChannel('channel');
    const customTitle = interaction.options.getString('title');
    const color = interaction.options.getString('color');
    const pingEveryone = interaction.options.getBoolean('ping') ?? true; // Default to true if not specified

    // Validate channel permissions
    const botMember = interaction.guild.members.me;
    if (!channel.permissionsFor(botMember).has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) {
      return interaction.reply({ 
        content: `I don't have permission to send messages in ${channel}!`, 
        ephemeral: true 
      });
    }

    // Build the embed
    const embed = new EmbedBuilder()
      .setTitle(customTitle || '📢 Announcement')
      .setDescription(message)
      .setColor(color && /^#[0-9A-F]{6}$/i.test(color) ? color : '#FFD700') // Validate hex color, default to gold
      .setTimestamp()
      .setFooter({ 
        text: `Announced by ${interaction.user.tag}`, 
        iconURL: interaction.user.displayAvatarURL() 
      });

    try {
      // Send the announcement
      const content = pingEveryone ? '@everyone' : undefined;
      const sentMessage = await channel.send({ 
        content, 
        embeds: [embed] 
      });

      // Create success reply
      const successEmbed = new EmbedBuilder()
        .setDescription(`Announcement sent to ${channel}! [View it here](${sentMessage.url})`)
        .setColor('#00FF00')
        .setTimestamp();

      await interaction.reply({ embeds: [successEmbed], ephemeral: true });

      // Log to modlog if configured
      const modlogChannelId = client.settings.get(`${interaction.guild.id}:modlog`);
      if (modlogChannelId) {
        const modlogChannel = interaction.guild.channels.cache.get(modlogChannelId);
        if (modlogChannel && modlogChannel.permissionsFor(botMember).has(PermissionsBitField.Flags.SendMessages)) {
          const logEmbed = new EmbedBuilder()
            .setTitle('Announcement Logged')
            .setDescription(`**Author:** ${interaction.user.tag} (${interaction.user.id})\n**Channel:** ${channel}\n**Message:** ${message}`)
            .setColor('#FFD700')
            .setTimestamp();
          await modlogChannel.send({ embeds: [logEmbed] });
        }
      }
    } catch (error) {
      console.error(`Failed to send announcement: ${error}`);
      await interaction.reply({ 
        content: 'Failed to send the announcement. Please check my permissions and try again.', 
        ephemeral: true 
      });
    }
  },
};