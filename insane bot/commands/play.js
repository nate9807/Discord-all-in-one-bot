require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const youtubedl = require('youtube-dl-exec');
const ytSearch = require('yt-search');
const logger = require('../utils/logger');
const { google } = require('googleapis');

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

async function execute(interaction, client) {
  await interaction.deferReply();

  const guildId = interaction.guild.id;
  const member = interaction.member;
  const channel = interaction.channel;

  if (!member.voice.channel) {
    return interaction.editReply({ content: 'Join a voice channel first!' });
  }

  let queue = client.queues.get(guildId) || {
    connection: null,
    songs: [],
    volume: 0.5,
    loop: false,
    playing: false,
    player: null,
    currentPosition: 0,
    initiator: member.id,
    history: [],
    repeatMode: 'off',
    liveProcess: null,
    isSkipping: false
  };

  if (!queue.connection) {
    queue.connection = joinVoiceChannel({
      channelId: member.voice.channel.id,
      guildId: guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });
    queue.connection.on(VoiceConnectionStatus.Disconnected, () => {
      logger.info(`Disconnected from voice channel in guild ${guildId}`);
      cleanupQueue(guildId, client);
    });
    queue.player = createAudioPlayer({
      behaviors: { noSubscriber: 'play' }
    });
    queue.connection.subscribe(queue.player);
    setupPlayerListeners(guildId, queue, channel, client);
    client.queues.set(guildId, queue);
    logger.info(`Joined voice channel in guild ${guildId}`);
  }

  try {
    const query = interaction.options.getString('query');
    let song;

    if (ytdl.validateURL(query)) {
      const videoId = extractVideoId(query);
      const response = await youtube.videos.list({
        part: 'snippet,contentDetails,liveStreamingDetails',
        id: videoId
      });
      const video = response.data.items[0];
      if (!video) throw new Error('Video not found');

      const isLive = !!video.liveStreamingDetails;
      logger.warn(`Video "${video.snippet.title}" isLive: ${isLive}`);

      song = {
        title: video.snippet.title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        duration: isLive ? Infinity : parseDuration(video.contentDetails.duration),
        author: video.snippet.channelTitle,
        thumbnail: video.snippet.thumbnails.default?.url || null,
        isLive: isLive
      };
    } else {
      logger.info(`Searching for: ${query}`);
      const result = await ytSearch(query);
      if (!result.videos.length) throw new Error('No results found');
      song = {
        title: result.videos[0].title,
        url: result.videos[0].url,
        duration: result.videos[0].duration.seconds,
        author: result.videos[0].author.name,
        thumbnail: result.videos[0].thumbnail,
        isLive: false
      };
    }

    queue.songs.push(song);
    client.queues.set(guildId, queue);
    logger.info(`Added ${song.isLive ? 'live stream' : 'song'} "${song.title}" to queue in guild ${guildId}`);

    const embed = new EmbedBuilder()
      .setColor(song.isLive ? '#FF0000' : '#00FFFF')
      .setTitle(song.isLive ? 'Streaming 24/7' : 'Added to Queue')
      .setThumbnail(song.thumbnail)
      .setDescription(`**${song.title}** by ${song.author}${song.isLive ? '\nPlaying continuously until skipped...' : ''}`)
      .addFields(
        { name: song.isLive ? 'Status' : 'Duration', value: song.isLive ? 'LIVE' : formatDuration(song.duration), inline: true },
        { name: 'Position', value: `${queue.songs.length}`, inline: true }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });

    if (!queue.playing) {
      logger.info(`Starting playback for guild ${guildId} from execute`);
      await playSong(guildId, queue, channel, client);
    }

  } catch (error) {
    logger.error('Play command error:', error.message || error);
    await interaction.editReply({ content: `Failed to play: ${error.message || 'Unknown error'}` });
  }
}

async function playSong(guildId, queue, channel, client) {
  const song = queue.songs[0];
  if (!song) {
    queue.playing = false;
    queue.isSkipping = false;
    client.queues.set(guildId, queue);
    logger.info(`Queue empty in guild ${guildId}, ending playback`);
    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle('Queue Ended')
      .setDescription('The queue has finished playing. Leaving voice channel...')
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    cleanupQueue(guildId, client); // Leave channel when queue is empty
    return;
  }

  try {
    let audioStream;
    if (song.isLive) {
      logger.warn(`Starting live stream for "${song.title}" with URL: ${song.url}`);
      const process = youtubedl.exec(song.url, {
        format: 'bestaudio/best',
        output: '-',
        quiet: true,
        noWarnings: true,
        limitRate: '1M',
        liveFromStart: true
      }, { stdio: ['ignore', 'pipe', 'pipe'] });

      queue.liveProcess = process;
      audioStream = process.stdout;

      process.stderr.on('data', (data) => {
        logger.error(`yt-dlp stderr for "${song.title}" in guild ${guildId}:`, data.toString());
      });

      process.on('error', (err) => {
        logger.error(`yt-dlp process error for "${song.title}" in guild ${guildId}:`, err.message);
        if (!queue.isSkipping) {
          channel.send({ content: `Streaming process error: ${err.message}, skipping...` });
          skipSong(guildId, queue, channel, client);
        }
      });

      process.on('exit', (code, signal) => {
        logger.info(`yt-dlp process for "${song.title}" in guild ${guildId} exited with code ${code}, signal ${signal}`);
        if (signal === 'SIGTERM' && queue.isSkipping) {
          logger.info(`Livestream "${song.title}" terminated by skip in guild ${guildId}, ignoring`);
          return;
        }
        if (queue.playing && code !== 0 && !queue.isSkipping) {
          channel.send({ content: `Livestream exited unexpectedly, skipping...` });
          skipSong(guildId, queue, channel, client);
        }
      });

      process.catch((err) => {
        if (err.signal === 'SIGTERM' && queue.isSkipping) {
          logger.info(`yt-dlp process for "${song.title}" in guild ${guildId} terminated by skip, ignoring error`);
          return;
        }
        logger.error(`yt-dlp exec error for "${song.title}" in guild ${guildId}:`, err.message);
        if (!queue.isSkipping) {
          channel.send({ content: `Streaming error: ${err.message}, skipping...` });
          skipSong(guildId, queue, channel, client);
        }
      });
    } else {
      audioStream = ytdl(song.url, {
        filter: 'audioonly',
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': 'https://www.youtube.com',
            'Referer': 'https://www.youtube.com/'
          }
        }
      });
    }

    if (!audioStream) throw new Error('Failed to initialize stream');

    logger.info(`Stream initialized for "${song.title}" in guild ${guildId}`);

    audioStream.on('error', (err) => {
      if (err.message === 'Premature close' && !queue.liveProcess && queue.isSkipping) {
        logger.info(`Ignoring premature close error for "${song.title}" in guild ${guildId} during skip`);
        return;
      }
      logger.error(`Stream error for "${song.title}" in guild ${guildId}:`, err.message);
      if (!queue.isSkipping) {
        channel.send({ content: `Stream error: ${err.message}, skipping...` });
        skipSong(guildId, queue, channel, client);
      }
    });

    const resource = createAudioResource(audioStream, { inlineVolume: true });
    resource.volume.setVolume(queue.volume);
    queue.player.play(resource);
    queue.playing = true;
    client.queues.set(guildId, queue);

    logger.info(`Started playing "${song.title}" in guild ${guildId}`);

  } catch (error) {
    logger.error(`Play song error for "${song.title}" in guild ${guildId}:`, error.message);
    if (!queue.isSkipping) {
      channel.send({ content: `Failed to play "${song.title}": ${error.message}, skipping...` });
      skipSong(guildId, queue, channel, client);
    }
  }
}

function setupPlayerListeners(guildId, queue, channel, client) {
  queue.player.on('stateChange', (oldState, newState) => {
    if (newState.status === AudioPlayerStatus.Playing) {
      logger.info(`Player state changed to Playing in guild ${guildId}`);
    }
  });

  queue.player.on(AudioPlayerStatus.Idle, async () => {
    const song = queue.songs[0] || { title: 'Unknown', isLive: false };
    logger.info(`Idle event triggered for "${song.title}" in guild ${guildId}, isSkipping: ${queue.isSkipping}`);
    if (!queue.isSkipping) {
      const finishedSong = queue.songs.shift();
      if (!song.isLive && finishedSong) queue.history.unshift(finishedSong);
      if (!song.isLive && queue.repeatMode === 'song' && finishedSong) {
        queue.songs.unshift(finishedSong);
      } else if (!song.isLive && queue.repeatMode === 'queue' && finishedSong) {
        queue.songs.push(finishedSong);
      } else if (!song.isLive && queue.loop && finishedSong) {
        queue.songs.push(finishedSong);
      }
      if (queue.history.length > 10) queue.history = queue.history.slice(0, 10);
      if (queue.liveProcess) {
        queue.liveProcess.kill('SIGTERM');
        queue.liveProcess = null;
      }
      client.queues.set(guildId, queue);

      logger.info(`Queue after idle (natural end) in guild ${guildId}: ${JSON.stringify(queue.songs.map(s => s.title))}`);
      if (queue.songs.length) {
        logger.info(`Playing next song from idle in guild ${guildId}. Queue length: ${queue.songs.length}`);
        await playSong(guildId, queue, channel, client);
      } else {
        queue.playing = false;
        queue.isSkipping = false;
        client.queues.set(guildId, queue);
        logger.info(`Queue ended naturally in guild ${guildId}`);
        const embed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Queue Ended')
          .setDescription('The queue has finished playing. Leaving voice channel...')
          .setTimestamp();
        await channel.send({ embeds: [embed] });
        cleanupQueue(guildId, client); // Leave channel when queue ends naturally
      }
    } else {
      logger.info(`Skipping detected, deferring to skip command in guild ${guildId}`);
    }
  });

  queue.player.on('error', (err) => {
    const song = queue.songs[0] || { title: 'Unknown' };
    logger.error(`Player error for "${song.title}" in guild ${guildId}:`, err.message);
    if (!queue.isSkipping) {
      channel.send({ content: `Player error: ${err.message}, skipping...` });
      skipSong(guildId, queue, channel, client);
    }
  });
}

function skipSong(guildId, queue, channel, client) {
  if (queue.player && queue.playing) {
    queue.player.stop();
    logger.info(`Stopped player for guild ${guildId}`);
  }
  if (queue.liveProcess) {
    queue.liveProcess.kill('SIGTERM');
    queue.liveProcess = null;
  }
  const skippedSong = queue.songs.shift();
  if (skippedSong && !skippedSong.isLive) queue.history.unshift(skippedSong);
  if (queue.loop && skippedSong) queue.songs.push(skippedSong);
  client.queues.set(guildId, queue);

  logger.info(`After skip, queue in guild ${guildId}: ${JSON.stringify(queue.songs.map(s => s.title))}`);
  if (queue.songs.length) {
    logger.info(`Skipping to next song in guild ${guildId}, queue length: ${queue.songs.length}`);
    playSong(guildId, queue, channel, client);
  } else {
    queue.playing = false;
    queue.isSkipping = false;
    client.queues.set(guildId, queue);
    logger.info(`Queue ended after skip in guild ${guildId}`);
    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle('Queue Ended')
      .setDescription('The queue has finished playing. Leaving voice channel...')
      .setTimestamp();
    channel.send({ embeds: [embed] });
    cleanupQueue(guildId, client); // Leave channel when queue ends after skip
  }
}

function cleanupQueue(guildId, client) {
  const queue = client.queues.get(guildId);
  if (queue) {
    if (queue.liveProcess) {
      queue.liveProcess.kill('SIGTERM');
    }
    if (queue.connection) {
      queue.connection.destroy();
      logger.info(`Bot left voice channel in guild ${guildId}`);
    }
    client.queues.delete(guildId);
    logger.info(`Cleaned up queue for guild ${guildId}`);
  }
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours ? `${hours}:` : ''}${minutes < 10 && hours ? '0' : ''}${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

function extractVideoId(url) {
  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

function parseDuration(duration) {
  const regExp = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
  const matches = duration.match(regExp);
  if (!matches) return 0;
  const hours = parseInt(matches[1] || 0);
  const minutes = parseInt(matches[2] || 0);
  const seconds = parseInt(matches[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or 24/7 live stream from YouTube.')
    .addStringOption(option => 
      option.setName('query')
        .setDescription('YouTube URL or search term (supports live streams)')
        .setRequired(true)),
  cooldown: 5,
  execute,
  playSong,
  skipSong,
  cleanupQueue,
  formatDuration,
  extractVideoId,
  parseDuration
};