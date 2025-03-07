require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { playSong, formatDuration } = require('./play'); // Import formatDuration for consistency

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song or to a specific index.')
    .addIntegerOption(option => option.setName('index').setDescription('Queue index to skip to').setRequired(false)),
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();

    const guildId = interaction.guild.id;
    const channel = interaction.channel;
    const queue = client.queues.get(guildId);

    if (!queue || !queue.songs.length) {
      return interaction.editReply({ content: 'Nothing is playing to skip!' });
    }

    try {
      queue.isSkipping = true;
      if (queue.player && queue.playing) {
        queue.player.stop();
        logger.info(`Stopped current playback in guild ${guildId}`);
      }
      if (queue.liveProcess) {
        queue.liveProcess.kill('SIGTERM');
        queue.liveProcess = null;
      }

      const index = interaction.options.getInteger('index');
      let embed;

      if (index !== null && index >= 0 && index < queue.songs.length) {
        const skippedSongs = queue.songs.splice(0, index);
        if (queue.loop) queue.songs.push(...skippedSongs);
        queue.history.unshift(...skippedSongs.reverse());
        embed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Skipped')
          .setDescription(`Skipped to **${queue.songs[0].title}**`)
          .setThumbnail(queue.songs[0].thumbnail)
          .addFields({ name: 'Author', value: queue.songs[0].author, inline: true })
          .setTimestamp();
      } else {
        const skippedSong = queue.songs.shift();
        if (skippedSong && !skippedSong.isLive) queue.history.unshift(skippedSong);
        if (queue.loop && skippedSong) queue.songs.push(skippedSong);
        embed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Skipped')
          .setDescription(`Skipped **${skippedSong.title}**`)
          .setThumbnail(skippedSong.thumbnail)
          .setTimestamp();
      }

      await interaction.editReply({ embeds: [embed] });

      if (queue.history.length > 10) queue.history = queue.history.slice(0, 10);
      client.queues.set(guildId, queue);

      logger.info(`Queue after skip command in guild ${guildId}: ${JSON.stringify(queue.songs.map(s => s.title))}`);
      if (queue.songs.length) {
        logger.info(`Playing next song after skip in guild ${guildId}`);
        await playSong(guildId, queue, channel, client);

        // Show the now playing song
        const nowPlaying = queue.songs[0];
        const nowPlayingEmbed = new EmbedBuilder()
          .setColor(nowPlaying.isLive ? '#FF0000' : '#00FFFF')
          .setTitle('Now Playing')
          .setThumbnail(nowPlaying.thumbnail)
          .setDescription(`**${nowPlaying.title}** by ${nowPlaying.author}${nowPlaying.isLive ? '\nStreaming continuously until skipped...' : ''}`)
          .addFields(
            { name: nowPlaying.isLive ? 'Status' : 'Duration', value: nowPlaying.isLive ? 'LIVE' : formatDuration(nowPlaying.duration), inline: true }
          )
          .setTimestamp();
        await channel.send({ embeds: [nowPlayingEmbed] });
      } else {
        queue.playing = false;
        queue.isSkipping = false;
        client.queues.set(guildId, queue);
        const endEmbed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Queue Ended')
          .setDescription('The queue has finished playing. Leaving voice channel...')
          .setTimestamp();
        await channel.send({ embeds: [endEmbed] });
        const { cleanupQueue } = require('./play'); // Import here to avoid circular dependency
        cleanupQueue(guildId, client); // Leave channel when queue ends
      }

    } catch (error) {
      logger.error('Skip command error:', error.message || error);
      await interaction.editReply({ content: `Failed to skip: ${error.message || 'Unknown error'}` });
    }
  },
};