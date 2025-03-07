const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automodconfig')
    .setDescription('Configure AutoMod bad words.')
    .addStringOption(option => option.setName('badwords').setDescription('Comma-separated bad words').setRequired(true)),
  cooldown: 10,
  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'You need Administrator permissions!', ephemeral: true });
    }
    const badWords = interaction.options.getString('badwords').split(',').map(word => word.trim().toLowerCase());
    client.settings.set(`${interaction.guild.id}:badwords`, badWords);
    const embed = new EmbedBuilder()
      .setTitle('AutoMod Configured')
      .setDescription(`Bad words set to: ${badWords.join(', ') || 'None'}`)
      .setColor('#00FF00')
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};