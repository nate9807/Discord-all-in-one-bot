const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { getVoiceConnection } = require('@discordjs/voice');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue.'),
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();

    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    if (!queue || !queue.songs.length) {
      const connection = getVoiceConnection(guildId);
      if (connection) {
        try {
          connection.destroy();
          client.queues.delete(guildId);
          logger.info(`Bot left voice channel in guild ${guildId} due to empty queue`);
          return interaction.editReply({ content: 'The queue is empty! I have left the voice channel.' });
        } catch (error) {
          logger.error(`Error leaving voice channel in guild ${guildId}: ${error.message}`);
          return interaction.editReply({ content: 'The queue is empty, but I failed to leave the voice channel.' });
        }
      }
      return interaction.editReply({ content: 'The queue is empty!' });
    }

    try {
      const embed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('Current Queue')
        .setDescription(queue.songs.map((song, i) => `${i + 1}. **${song.title}** (${formatDuration(song.duration)})`).join('\n'))
        .addFields(
          { name: 'Now Playing', value: queue.songs[0] ? `**${queue.songs[0].title}** by ${queue.songs[0].author}` : 'None', inline: true },
          { name: 'Total Duration', value: formatDuration(queue.songs.reduce((acc, song) => acc + song.duration, 0)), inline: true }
        )
        .setThumbnail(queue.songs[0]?.thumbnail)
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error('Queue command error:', error.message || error);
      await interaction.editReply({ content: `Failed to show queue: ${error.message || 'Unknown error'}` });
    }
  },
};

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}