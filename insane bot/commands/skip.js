require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { playSong, formatDuration } = require('./play.js'); // Add .js extension for consistency

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Number of songs to skip (default: 1)')
        .setMinValue(1)),
  cooldown: 3,
  async execute(interaction, client) {
    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    try {
      if (!queue || !queue.songs.length) {
        logger.warn(`Skip command failed: No active queue in guild ${guildId}`);
        return interaction.reply({ content: 'Nothing is playing right now!', ephemeral: true });
      }

      if (!interaction.member.voice.channel) {
        logger.warn(`Skip command failed: User not in voice channel in guild ${guildId}`);
        return interaction.reply({ content: 'You need to be in a voice channel to skip!', ephemeral: true });
      }

      // Check if user is in the same channel as the bot
      const botVoiceChannel = queue.connection?.joinConfig?.channelId;
      if (botVoiceChannel && interaction.member.voice.channel.id !== botVoiceChannel) {
        logger.warn(`Skip command failed: User in different voice channel in guild ${guildId}`);
        return interaction.reply({ content: 'You need to be in the same voice channel as the bot!', ephemeral: true });
      }

      const skipAmount = interaction.options.getInteger('amount') || 1;
      const currentSong = queue.songs[0];
      const queueLength = queue.songs.length;

      if (skipAmount > queueLength) {
        logger.warn(`Skip command failed: Tried to skip ${skipAmount} songs but only ${queueLength} in queue in guild ${guildId}`);
        return interaction.reply({ 
          content: `Cannot skip ${skipAmount} songs! Only ${queueLength} songs in queue.`,
          ephemeral: true 
        });
      }

      // Mark as skipping to prevent duplicate skips
      queue.isSkipping = true;

      // Stop current playback
      if (queue.player) {
        queue.player.stop();
      }

      // Kill live stream process if exists
      if (queue.liveProcess) {
        queue.liveProcess.kill('SIGTERM');
        queue.liveProcess = null;
      }

      // Remove skipped songs and add to history
      const skippedSongs = queue.songs.splice(0, skipAmount);
      skippedSongs.forEach(song => {
        if (!song.isLive) {
          queue.history.unshift(song);
        }
      });

      // Trim history if needed
      if (queue.history.length > 50) {
        queue.history = queue.history.slice(0, 50);
      }

      client.queues.set(guildId, queue);
      
      logger.music(`Skipped ${skipAmount} song(s) in guild ${guildId} by ${interaction.user.tag}`);
      logger.info(`Skipped "${currentSong.title}" and ${skipAmount - 1} more songs in guild ${guildId}`);

      const embed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('⏭️ Skipped')
        .setDescription(skipAmount === 1
          ? `Skipped **${currentSong.title}**`
          : `Skipped **${skipAmount}** songs, including **${currentSong.title}**`)
        .addFields(
          { name: 'Remaining', value: `${queue.songs.length} songs in queue`, inline: true },
          { name: 'Next Up', value: queue.songs[0] ? `${queue.songs[0].title}` : 'Nothing - queue ended', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Start playing next song if queue not empty
      if (queue.songs.length > 0) {
        const { playSong } = require('./play.js');
        await playSong(guildId, queue, interaction.channel, client);
      } else {
        queue.playing = false;
        queue.isSkipping = false;
        client.queues.set(guildId, queue);
        
        const endEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('Queue Ended')
          .setDescription('No more songs in queue. Leaving voice channel...')
          .setTimestamp();
        
        await interaction.channel.send({ embeds: [endEmbed] });
        
        // Cleanup and leave
        if (queue.connection) {
          queue.connection.destroy();
        }
        client.queues.delete(guildId);
        logger.music(`Queue ended after skip in guild ${guildId}`);
      }
    } catch (error) {
      logger.error(`Skip command error in guild ${guildId}:`, error);
      await interaction.reply({ 
        content: 'Failed to skip the song. Please try again.',
        ephemeral: true 
      });
    }
  },
};