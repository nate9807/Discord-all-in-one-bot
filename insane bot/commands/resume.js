const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume the paused music.'),
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();

    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    // Check if there's a queue and player
    if (!queue || !queue.player) {
      return interaction.editReply({ content: 'Nothing is available to resume!' });
    }

    // Check if the player is actually paused
    if (queue.player.state.status !== AudioPlayerStatus.Paused) {
      return interaction.editReply({ content: 'The music is already playing or not paused!' });
    }

    try {
      queue.player.unpause();
      queue.playing = true;
      client.queues.set(guildId, queue);

      const embed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('Resumed')
        .setDescription(`Resumed **${queue.songs[0].title}**`)
        .setThumbnail(queue.songs[0].thumbnail)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error('Resume command error:', error.message || error);
      await interaction.editReply({ content: `Failed to resume: ${error.message || 'Unknown error'}` });
    }
  },
};