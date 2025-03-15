require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const ytSearch = require('yt-search');
const SpotifyWebApi = require('spotify-web-api-node');
const logger = require('../utils/logger');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

const AUDIO_DIR = path.join(__dirname, 'audio_cache');

async function ensureAudioDir() {
  try {
    await fs.mkdir(AUDIO_DIR, { recursive: true });
  } catch (error) {
    logger.error('Failed to create audio directory:', error);
  }
}

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

const SPOTIFY_PATTERNS = {
  TRACK: /^(?:https?:\/\/)?(?:open\.)?spotify\.com\/track\/([a-zA-Z0-9]+)(?:\?.*)?$/,
  ALBUM: /^(?:https?:\/\/)?(?:open\.)?spotify\.com\/album\/([a-zA-Z0-9]+)(?:\?.*)?$/,
  PLAYLIST: /^(?:https?:\/\/)?(?:open\.)?spotify\.com\/playlist\/([a-zA-Z0-9]+)(?:\?.*)?$/
};

async function execute(interaction, client) {
  await ensureAudioDir();
  await interaction.deferReply();

  const guildId = interaction.guild.id;
  const member = interaction.member;
  const channel = interaction.channel;

  if (!member.voice.channel) {
    logger.warn(`Play command failed: User not in voice channel in guild ${guildId}`);
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
    isSkipping: false,
    downloading: new Map(),
    effects: {
      bassboost: false,
      nightcore: false,
      vaporwave: false
    }
  };

  if (!queue.connection) {
    try {
      queue.connection = joinVoiceChannel({
        channelId: member.voice.channel.id,
        guildId: guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      queue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        logger.music(`Disconnected from voice channel in guild ${guildId}`);
        try {
          await Promise.race([
            entersState(queue.connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(queue.connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
          logger.music(`Attempting to reconnect in guild ${guildId}`);
        } catch (error) {
          logger.music(`Cleaning up connection in guild ${guildId}`);
          cleanupQueue(guildId, client);
        }
      });

      queue.connection.on(VoiceConnectionStatus.Destroyed, () => {
        logger.music(`Voice connection destroyed in guild ${guildId}`);
        cleanupQueue(guildId, client);
      });

      queue.player = createAudioPlayer({
        behaviors: { noSubscriber: 'play' }
      });

      queue.connection.subscribe(queue.player);
      setupPlayerListeners(guildId, queue, channel, client);
      client.queues.set(guildId, queue);
      logger.music(`Joined voice channel in guild ${guildId}`);
    } catch (error) {
      logger.error(`Failed to join voice channel in guild ${guildId}:`, error);
      return interaction.editReply({ content: 'Failed to join voice channel.' });
    }
  }

  try {
    const query = interaction.options.getString('query');
    let songs = [];

    const spotifyTrackMatch = query.match(SPOTIFY_PATTERNS.TRACK);
    const spotifyAlbumMatch = query.match(SPOTIFY_PATTERNS.ALBUM);
    const spotifyPlaylistMatch = query.match(SPOTIFY_PATTERNS.PLAYLIST);

    if (spotifyTrackMatch || spotifyAlbumMatch || spotifyPlaylistMatch) {
      const spotifyApi = new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET
      });

      const data = await spotifyApi.clientCredentialsGrant();
      spotifyApi.setAccessToken(data.body['access_token']);

      if (spotifyTrackMatch) {
        const trackId = spotifyTrackMatch[1];
        const track = await spotifyApi.getTrack(trackId);
        songs.push(await prepareSongFromSpotify(track.body, interaction.user.tag));
      } else if (spotifyAlbumMatch) {
        const albumId = spotifyAlbumMatch[1];
        const album = await spotifyApi.getAlbum(albumId);
        songs = await Promise.all(album.body.tracks.items.map(track => 
          prepareSongFromSpotify(track, interaction.user.tag)));
      } else if (spotifyPlaylistMatch) {
        const playlistId = spotifyPlaylistMatch[1];
        const playlist = await spotifyApi.getPlaylist(playlistId);
        songs = await Promise.all(playlist.body.tracks.items
          .filter(item => item.track)
          .map(item => prepareSongFromSpotify(item.track, interaction.user.tag)));
      }
    } else {
      const videoId = extractVideoId(query);
      if (videoId) {
        const response = await youtube.videos.list({
          part: 'snippet,contentDetails,liveStreamingDetails',
          id: videoId
        });
        const video = response.data.items[0];
        if (!video) throw new Error('Video not found');
        songs = [await prepareSongFromYouTube(video, interaction.user.tag, query)];
      } else {
        const result = await ytSearch(query);
        if (!result.videos.length) throw new Error('No results found');
        songs = [await prepareSongFromYouTubeSearch(result.videos[0], interaction.user.tag)];
      }
    }

    queue.songs.push(...songs);
    client.queues.set(guildId, queue);
    startDownloadQueue(guildId, queue, client);

    const embed = new EmbedBuilder()
      .setColor(songs[0].isLive ? '#FF0000' : '#00FFFF')
      .setTitle(songs[0].isLive ? 'Streaming 24/7' : 'Added to Queue')
      .setThumbnail(songs[0].thumbnail)
      .setDescription(`**${songs[0].title}** by ${songs[0].author}${songs[0].isLive ? '\nPlaying continuously until skipped...' : ''}`)
      .addFields(
        { name: songs[0].isLive ? 'Status' : 'Duration', value: songs[0].isLive ? 'LIVE' : formatDuration(songs[0].duration), inline: true },
        { name: 'Position', value: `${queue.songs.length}`, inline: true },
        { name: 'Requested By', value: songs[0].requestedBy, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    if (!queue.playing) {
      logger.music(`Starting playback for guild ${guildId}`);
      await playSong(guildId, queue, channel, client);
    }

  } catch (error) {
    logger.error(`Play command error in guild ${guildId}:`, error);
    await interaction.editReply({ content: `Failed to play: ${error.message || 'An unexpected error occurred'}` });
  }
}

async function prepareSongFromSpotify(track, requestedBy) {
  const searchQuery = `${track.name} ${track.artists[0].name}`;
  const result = await ytSearch(searchQuery);
  if (!result.videos.length) throw new Error(`No YouTube match for ${track.name}`);
  
  return {
    title: track.name,
    author: track.artists.map(artist => artist.name).join(', '),
    duration: track.duration_ms / 1000,
    thumbnail: track.album.images[0]?.url,
    isLive: false,
    requestedBy,
    url: result.videos[0].url,
    filePath: null
  };
}

async function prepareSongFromYouTube(video, requestedBy, url) {
  return {
    title: video.snippet.title,
    url: url,
    duration: video.liveStreamingDetails ? Infinity : parseDuration(video.contentDetails.duration),
    author: video.snippet.channelTitle,
    thumbnail: video.snippet.thumbnails.default?.url,
    isLive: !!video.liveStreamingDetails,
    requestedBy,
    filePath: null
  };
}

async function prepareSongFromYouTubeSearch(video, requestedBy) {
  return {
    title: video.title,
    url: video.url,
    duration: video.duration.seconds,
    author: video.author.name,
    thumbnail: video.thumbnail,
    isLive: false,
    requestedBy,
    filePath: null
  };
}

async function downloadSong(song, guildId, queue, client) {
  if (song.isLive) return Promise.resolve();
  
  const videoId = extractVideoId(song.url);
  const filePath = path.join(AUDIO_DIR, `${videoId}.mp3`);
  
  // Check if file already exists on disk
  if (await fs.access(filePath).then(() => true).catch(() => false)) {
    song.filePath = filePath;
    logger.music(`Reusing existing file "${song.title}" at ${filePath} for guild ${guildId}`);
    return Promise.resolve();
  }
  
  // If filePath is already set and exists, reuse it
  if (song.filePath && (await fs.access(song.filePath).then(() => true).catch(() => false))) {
    logger.music(`Reusing previously set file "${song.title}" at ${song.filePath} for guild ${guildId}`);
    return Promise.resolve();
  }

  if (!queue) return Promise.reject(new Error('Queue not found'));

  if (queue.downloading.has(videoId)) {
    return queue.downloading.get(videoId);
  }

  const downloadPromise = (async () => {
    try {
      logger.music(`Starting download of "${song.title}" for guild ${guildId}`);
      
      const downloadProcess = youtubedl.exec(song.url, {
        format: 'bestaudio',
        output: filePath,
        audioFormat: 'mp3',
        verbose: true
      });

      let errorOutput = '';
      downloadProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      await downloadProcess;
      await fs.access(filePath);
      
      song.filePath = filePath;
      logger.music(`Downloaded "${song.title}" to ${filePath} for guild ${guildId}`);
      
      queue.downloading.delete(videoId);
      client.queues.set(guildId, queue);
    } catch (error) {
      logger.error(`Failed to download "${song.title}" for guild ${guildId}:`, {
        error: error.message,
        stack: error.stack,
        url: song.url,
        output: errorOutput || 'No additional output'
      });
      song.filePath = null;
      throw new Error(`Download failed: ${error.message}`);
    }
  })();

  queue.downloading.set(videoId, downloadPromise);
  client.queues.set(guildId, queue);
  return downloadPromise;
}

function startDownloadQueue(guildId, queue, client) {
  if (!queue) return;

  queue.songs.forEach(song => {
    if (!song.filePath && !song.isLive) {
      downloadSong(song, guildId, queue, client).catch(err => {
        logger.error(`Background download failed for "${song.title}" in guild ${guildId}:`, err);
      });
    }
  });
}

async function playSong(guildId, queue, channel, client) {
  if (!queue.songs.length) {
    logger.music(`No more songs in queue for guild ${guildId}`);
    cleanupQueue(guildId, client);
    return;
  }

  const song = queue.songs[0];
  
  try {
    let stream;

    if (!song.isLive) {
      if (!song.filePath) {
        logger.music(`Waiting for download of "${song.title}" in guild ${guildId}`);
        await downloadSong(song, guildId, queue, client);
      }
      if (!song.filePath || !(await fs.access(song.filePath).then(() => true).catch(() => false))) {
        throw new Error('Failed to download song or file not found');
      }
      stream = song.filePath;
    } else {
      const process = youtubedl.exec(song.url, {
        format: 'bestaudio',
        output: '-',
        quiet: true
      });
      stream = process.stdout;
      queue.liveProcess = process;
    }

    const resource = createAudioResource(stream, {
      inlineVolume: true,
      inputType: song.isLive ? 'raw' : 'mp3'
    });

    resource.volume?.setVolume(queue.volume);

    if (!queue.player) {
      queue.player = createAudioPlayer();
      setupPlayerListeners(guildId, queue, channel, client);
      queue.connection.subscribe(queue.player);
    }

    queue.player.play(resource);
    queue.playing = true;
    client.queues.set(guildId, queue);

    const embed = new EmbedBuilder()
      .setColor(song.isLive ? '#FF0000' : '#00FFFF')
      .setTitle(song.isLive ? '🔴 Now Streaming' : '🎵 Now Playing')
      .setDescription(`**${song.title}**${song.author ? ` by ${song.author}` : ''}`)
      .addFields(
        { name: song.isLive ? 'Type' : 'Duration', value: song.isLive ? 'LIVE' : formatDuration(song.duration), inline: true },
        { name: 'Requested By', value: song.requestedBy, inline: true },
        { name: 'Volume', value: `${Math.round(queue.volume * 100)}%`, inline: true }
      );

    if (song.thumbnail) embed.setThumbnail(song.thumbnail);
    if (channel) await channel.send({ embeds: [embed] });

  } catch (error) {
    logger.error(`Failed to play "${song.title}" in guild ${guildId}:`, error);
    await channel.send({ content: `Failed to play "${song.title}": ${error.message}. Skipping...` });
    skipSong(guildId, queue, channel, client);
  }
}

function setupPlayerListeners(guildId, queue, channel, client) {
  queue.player.on('stateChange', (oldState, newState) => {
    if (newState.status === AudioPlayerStatus.Playing) {
      logger.info(`Player state changed to Playing in guild ${guildId}`);
    }
  });

  queue.player.on(AudioPlayerStatus.Idle, async () => {
    if (queue.isSkipping) {
      queue.isSkipping = false;
      return;
    }

    const finishedSong = queue.songs[0];
    
    if (queue.repeatMode === 'song') {
      logger.info(`Repeating song "${finishedSong.title}" in guild ${guildId}`);
      await playSong(guildId, queue, channel, client);
      return;
    } else if (queue.repeatMode === 'queue' && queue.songs.length > 0) {
      queue.songs.shift();
      if (finishedSong) {
        queue.songs.push(finishedSong);
        logger.info(`Moving "${finishedSong.title}" to end of queue in guild ${guildId} (queue repeat mode)`);
      }
    } else {
      queue.songs.shift();
    }

    if (finishedSong && !finishedSong.isLive) {
      queue.history.push(finishedSong);
      if (queue.history.length > 50) queue.history.shift();
    }

    client.queues.set(guildId, queue);
    await playSong(guildId, queue, channel, client);
  });

  queue.player.on('error', (error) => {
    logger.error(`Player error in guild ${guildId}:`, error);
    skipSong(guildId, queue, channel, client);
  });
}

function skipSong(guildId, queue, channel, client) {
  if (!queue) return;
  
  queue.isSkipping = true;
  
  if (queue.player) queue.player.stop();
  
  if (queue.liveProcess) {
    try {
      queue.liveProcess.kill('SIGTERM');
    } catch (error) {
      logger.error(`Failed to kill live process in guild ${guildId}:`, error);
    }
    queue.liveProcess = null;
  }

  const skippedSong = queue.songs.shift();
  if (skippedSong && !skippedSong.isLive) {
    queue.history = [skippedSong, ...queue.history].slice(0, 50);
  }

  client.queues.set(guildId, queue);
  
  if (queue.songs.length > 0) {
    playSong(guildId, queue, channel, client);
  } else {
    cleanupQueue(guildId, client);
  }
  
  queue.isSkipping = false;
}

async function cleanupQueue(guildId, client) {
  const queue = client.queues.get(guildId);
  if (!queue) return;

  if (queue.player) {
    queue.player.stop();
    queue.player = null;
  }

  if (queue.liveProcess) {
    try {
      queue.liveProcess.kill('SIGTERM');
    } catch (error) {
      logger.error(`Failed to kill live process during cleanup in guild ${guildId}:`, error);
    }
    queue.liveProcess = null;
  }

  if (queue.connection && queue.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    try {
      queue.connection.destroy();
    } catch (error) {
      logger.error(`Failed to destroy connection in guild ${guildId}:`, error);
    }
  }

  // Files are no longer deleted here - they persist in AUDIO_DIR
  client.queues.delete(guildId);
  logger.music(`Cleaned up queue for guild ${guildId} (audio files retained)`);
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return 'Unknown';
  if (seconds === Infinity) return 'LIVE';
  seconds = Math.round(Number(seconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours > 0 
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function extractVideoId(url) {
  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  return url.match(regExp)?.[1] || null;
}

function parseDuration(duration) {
  const regExp = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
  const matches = duration.match(regExp);
  if (!matches) return 0;
  return parseInt(matches[1] || 0) * 3600 + parseInt(matches[2] || 0) * 60 + parseInt(matches[3] || 0);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song from YouTube or Spotify.')
    .addStringOption(option => 
      option.setName('query')
        .setDescription('YouTube URL, Spotify URL, or search term')
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