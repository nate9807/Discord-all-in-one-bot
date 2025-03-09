const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { formatDuration } = require('./play.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show recently played songs.'),
  cooldown: 3,
  async execute(interaction, client) {
    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    if (!queue || !queue.history.length) {
      return interaction.reply({ content: 'No song history available!', ephemeral: true });
    }

    const historyList = queue.history
      .slice(0, 10) // Show last 10 songs
      .map((song, index) => {
        const duration = song.isLive ? 'LIVE' : formatDuration(song.duration);
        return `${index + 1}. **${song.title}** by ${song.author} (${duration})`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle('Recently Played Songs')
      .setDescription(historyList)
      .setFooter({ text: 'Showing last 10 songs' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
}; 