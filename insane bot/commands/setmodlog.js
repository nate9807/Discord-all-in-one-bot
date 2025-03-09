const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setmodlog')
    .setDescription('Set the modlog channel.')
    .addChannelOption(option => 
      option.setName('channel')
        .setDescription('The channel to set as modlog (leave empty to view current setting)')
        .setRequired(false)
    ),
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();

    // Check if the user has Administrator permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.editReply({ content: 'You need Administrator permissions!', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel');
    const currentModlogId = client.settings.get(`${interaction.guild.id}:modlog`);
    const currentModlog = currentModlogId ? await interaction.guild.channels.fetch(currentModlogId).catch(() => null) : null;

    // If no channel provided, show current setting
    if (!channel) {
      const embed = new EmbedBuilder()
        .setTitle('Current Modlog Settings')
        .setDescription(currentModlog 
          ? `✅ Modlog is currently set to ${currentModlog}`
          : '❌ No modlog channel is currently set')
        .setColor(currentModlog ? '#00FF00' : '#FF0000')
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // Check if the bot has Send Messages permission in the guild
    if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.SendMessages)) {
      return interaction.editReply({ content: 'I need Send Messages permissions!', ephemeral: true });
    }

    // Validate that the channel is text-based
    if (!channel.isTextBased() || channel.type === ChannelType.GuildVoice) {
      return interaction.editReply({ content: 'Please select a text-based channel!', ephemeral: true });
    }

    try {
      // Save the channel ID to settings
      client.settings.set(`${interaction.guild.id}:modlog`, channel.id);
      
      // Save settings to file
      await client.saveSettings();

      const embed = new EmbedBuilder()
        .setTitle('Modlog Settings Updated')
        .setDescription(
          `✅ Modlog channel has been updated\n\n` +
          `**Previous Channel:** ${currentModlog ? currentModlog : 'None'}\n` +
          `**New Channel:** ${channel}\n\n` +
          `All moderation actions will now be logged to ${channel}`
        )
        .setColor('#00FF00')
        .setTimestamp();

      // Send test message to new modlog channel
      const testEmbed = new EmbedBuilder()
        .setTitle('Modlog Channel Test')
        .setDescription('✅ This channel has been set as the modlog channel. You will see moderation actions logged here.')
        .setColor('#00FFFF')
        .setTimestamp();

      await channel.send({ embeds: [testEmbed] });
      await interaction.editReply({ embeds: [embed] });

      logger.info(`Modlog channel set to ${channel.name} (${channel.id}) in guild ${interaction.guild.id}`);
    } catch (error) {
      logger.error(`Failed to set modlog for guild ${interaction.guild.id}:`, error);
      await interaction.editReply({ 
        content: 'Failed to set the modlog channel. Please check my permissions and try again.', 
        ephemeral: true 
      });
    }
  }
};