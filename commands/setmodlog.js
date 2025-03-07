const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setmodlog')
    .setDescription('Set the modlog channel.')
    .addChannelOption(option => 
      option.setName('channel')
        .setDescription('The channel to set as modlog')
        .setRequired(true)
    ),
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();

    // Check if the user has Administrator permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.editReply({ content: 'You need Administrator permissions!', ephemeral: true });
    }

    // Check if the bot has Send Messages permission in the guild
    if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.SendMessages)) {
      return interaction.editReply({ content: 'I need Send Messages permissions!', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel');

    // Validate that the channel is text-based
    if (!channel.isTextBased() || channel.type === ChannelType.GuildVoice) {
      return interaction.editReply({ content: 'Please select a text-based channel!', ephemeral: true });
    }

    try {
      // Save the channel ID to settings
      client.settings.set(`${interaction.guild.id}:modlog`, channel.id);

      const embed = new EmbedBuilder()
        .setTitle('Modlog Channel Set')
        .setDescription(`Modlog set to ${channel}.`)
        .setColor('#00FF00')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(`Failed to set modlog for guild ${interaction.guild.id}: ${error.message}`);
      await interaction.editReply({ 
        content: 'Failed to set the modlog channel. Please try again later.', 
        ephemeral: true 
      });
    }
  },
};