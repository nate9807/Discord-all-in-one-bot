const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current song.'),
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();

    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    if (!queue || !queue.player) {
      return interaction.editReply({ content: 'Nothing is playing to pause!' });
    }
    if (queue.player.state.status !== AudioPlayerStatus.Playing) {
      return interaction.editReply({ content: 'The music is already paused or stopped!' });
    }

    try {
      queue.player.pause();
      queue.playing = false;
      client.queues.set(guildId, queue);
      const embed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('Paused')
        .setDescription(`Paused **${queue.songs[0].title}**`)
        .setThumbnail(queue.songs[0].thumbnail)
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error('Pause command error:', error.message || error);
      await interaction.editReply({ content: `Failed to pause: ${error.message || 'Unknown error'}` });
    }
  },
};