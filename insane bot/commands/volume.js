const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set music volume.')
    .addIntegerOption(option => option.setName('level').setDescription('Volume (0-100)').setRequired(true)),
  cooldown: 3,
  async execute(interaction, client) {
    const level = interaction.options.getInteger('level');
    const connection = getVoiceConnection(interaction.guild.id);
    if (!connection) return interaction.reply({ content: 'Not playing anything!', ephemeral: true });
    connection.state.subscription.player.state.resource.volume.setVolume(level / 100);
    const embed = new EmbedBuilder()
      .setTitle('Volume Set')
      .setDescription(`Volume set to **${level}%**.`)
      .setColor('#00FFFF')
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};