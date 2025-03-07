const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop the music and clear the queue.'),
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();

    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    if (!queue) {
      return interaction.editReply({ content: 'Nothing is playing to stop!' });
    }

    try {
      cleanupQueue(guildId, client);
      const embed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('Stopped')
        .setDescription('Music playback has been stopped and the queue cleared.')
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error('Stop command error:', error.message || error);
      await interaction.editReply({ content: `Failed to stop: ${error.message || 'Unknown error'}` });
    }
  },
};

function cleanupQueue(guildId, client) {
  const queue = client.queues.get(guildId);
  if (!queue) return;
  try {
    if (queue.player) {
      queue.player.stop();
      queue.player.removeAllListeners();
    }
    if (queue.connection) {
      queue.connection.destroy();
    }
    client.queues.delete(guildId);
  } catch (error) {
    logger.error(`Cleanup error in guild ${guildId}:`, error);
    client.queues.delete(guildId);
  }
}