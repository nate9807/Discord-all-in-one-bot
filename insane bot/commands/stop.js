const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playing and clear the queue'),
  cooldown: 3,
  async execute(interaction, client) {
    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    try {
      if (!queue || !queue.songs.length) {
        logger.warn(`Stop command failed: No active queue in guild ${guildId}`);
        return interaction.reply({ content: 'Nothing is playing right now!', ephemeral: true });
      }

      if (!interaction.member.voice.channel) {
        logger.warn(`Stop command failed: User not in voice channel in guild ${guildId}`);
        return interaction.reply({ content: 'You need to be in a voice channel to stop the music!', ephemeral: true });
      }

      // Check if user is in the same channel as the bot
      const botVoiceChannel = queue.connection?.joinConfig?.channelId;
      if (botVoiceChannel && interaction.member.voice.channel.id !== botVoiceChannel) {
        logger.warn(`Stop command failed: User in different voice channel in guild ${guildId}`);
        return interaction.reply({ content: 'You need to be in the same voice channel as the bot!', ephemeral: true });
      }

      // Save queue info for logging
      const songsCount = queue.songs.length;
      const currentSong = queue.songs[0];

      // Clear the queue and stop playing
      queue.songs = [];
      queue.playing = false;
      queue.repeatMode = 'off';
      
      if (queue.player) {
        queue.player.stop();
      }
      
      if (queue.connection) {
        queue.connection.destroy();
      }

      if (queue.liveProcess) {
        queue.liveProcess.kill('SIGTERM');
        queue.liveProcess = null;
      }

      client.queues.delete(guildId);
      
      logger.music(`Stopped playback and cleared queue (${songsCount} songs) in guild ${guildId} by ${interaction.user.tag}`);
      logger.info(`Last song playing was "${currentSong.title}" in guild ${guildId}`);

      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('⏹️ Stopped')
        .setDescription('Music playback has been stopped and the queue has been cleared.')
        .addFields(
          { name: 'Cleared', value: `${songsCount} songs from queue`, inline: true },
          { name: 'Last Playing', value: `${currentSong.title}`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error(`Stop command error in guild ${guildId}:`, error);
      await interaction.reply({ 
        content: 'Failed to stop the music. Please try again.',
        ephemeral: true 
      });
    }
  },
};