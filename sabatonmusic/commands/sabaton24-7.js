require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const SpotifyWebApi = require('spotify-web-api-node');
const youtubedl = require('youtube-dl-exec');
const ytSearch = require('yt-search');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

const AUDIO_DIR = path.join(__dirname, 'audio_cache');

async function ensureAudioDir() {
  try {
    await fs.mkdir(AUDIO_DIR, { recursive: true });
    logger.info('Audio directory ensured at ' + AUDIO_DIR);
  } catch (error) {
    logger.error('Failed to create audio directory:', error);
  }
}

const sabatonAlbums = [
  'Primo Victoria',
  'Attero Dominatus',
  'Metalizer',
  'The Art of War',
  'Coat of Arms',
  'Carolus Rex',
  'Heroes',
  'The Last Stand',
  'The Great War',
  'The War to End All Wars'
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sabaton24-7')
    .setDescription('Plays Sabaton music 24/7 in your voice channel')
    .addNumberOption(option =>
      option.setName('volume')
        .setDescription('Set the volume (0-100)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(100))
    .addBooleanOption(option =>
      option.setName('shuffle')
        .setDescription('Shuffle the playlist (default: true)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('album')
        .setDescription('Play a specific album')
        .addChoices(
          { name: 'All Albums (Shuffle)', value: 'all' },
          ...sabatonAlbums.map(album => ({
            name: album,
            value: album
          }))
        )
        .setRequired(false)),
  cooldown: 10,
  category: 'music',
  permissions: [
    PermissionsBitField.Flags.Connect,
    PermissionsBitField.Flags.Speak,
    PermissionsBitField.Flags.ViewChannel
  ],

  async execute(interaction, client) {
    await ensureAudioDir();

    const botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(this.permissions)) {
      logger.warn(`Bot lacks required permissions in guild ${interaction.guild.id}`);
      return interaction.reply({
        content: 'I need permissions to join and speak in voice channels!',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const guildId = interaction.guild.id;
    const member = interaction.member;
    const channel = interaction.channel;
    const volume = interaction.options.getNumber('volume') || 50;
    const shouldShuffle = interaction.options.getBoolean('shuffle') ?? true;
    const selectedAlbum = interaction.options.getString('album') || 'all';

    if (!member.voice.channel) {
      logger.warn(`Sabaton24-7 command failed: User not in voice channel in guild ${guildId}`);
      return interaction.editReply({
        content: 'You need to be in a voice channel to use this command!',
        ephemeral: true
      });
    }

    const voiceChannel = member.voice.channel;
    const permissions = voiceChannel.permissionsFor(botMember);
    if (!permissions.has([PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak])) {
      logger.warn(`Bot lacks permissions to join ${voiceChannel.name} in guild ${guildId}`);
      return interaction.editReply({
        content: `I don't have permission to join or speak in ${voiceChannel.name}!`,
        ephemeral: true
      });
    }

    try {
      const spotifyApi = new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET
      });

      const data = await spotifyApi.clientCredentialsGrant();
      spotifyApi.setAccessToken(data.body['access_token']);
      logger.info(`Spotify access token obtained for guild ${guildId}`);

      let queue = client.queues.get(guildId) || {
        connection: null,
        songs: [],
        volume: volume / 100,
        loop: true,
        playing: false,
        player: null,
        currentPosition: 0,
        initiator: member.id,
        history: [],
        repeatMode: 'all',
        liveProcess: null,
        isSkipping: false,
        downloading: new Map(),
        effects: {
          bassboost: false,
          nightcore: false,
          vaporwave: false
        }
      };

      let tracks = [];
      if (selectedAlbum === 'all') {
        for (const albumName of sabatonAlbums) {
          const searchResults = await spotifyApi.searchAlbums(`album:${albumName} artist:Sabaton`);
          if (searchResults.body.albums.items.length > 0) {
            const albumId = searchResults.body.albums.items[0].id;
            const albumTracks = await spotifyApi.getAlbumTracks(albumId);
            tracks.push(...albumTracks.body.items.map(track => ({
              title: track.name,
              author: 'Sabaton',
              album: albumName,
              duration: track.duration_ms / 1000,
              isLive: false,
              spotifyTrack: track,
              filePath: null
            })));
          }
        }
      } else {
        const searchResults = await spotifyApi.searchAlbums(`album:${selectedAlbum} artist:Sabaton`);
        if (searchResults.body.albums.items.length > 0) {
          const albumId = searchResults.body.albums.items[0].id;
          const albumTracks = await spotifyApi.getAlbumTracks(albumId);
          tracks = albumTracks.body.items.map(track => ({
            title: track.name,
            author: 'Sabaton',
            album: selectedAlbum,
            duration: track.duration_ms / 1000,
            isLive: false,
            spotifyTrack: track,
            filePath: null
          }));
        }
      }

      if (!tracks.length) {
        throw new Error('No tracks found! Please try again later.');
      }

      if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
        logger.info(`Attempting to join voice channel ${voiceChannel.name} in guild ${guildId}`);
        try {
          queue.connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guildId,
            adapterCreator: interaction.guild.voiceAdapterCreator,
          });

          await entersState(queue.connection, VoiceConnectionStatus.Ready, 10_000);
          logger.info(`Successfully joined voice channel ${voiceChannel.name} in guild ${guildId}`);

          queue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
            logger.warn(`Disconnected from voice channel in guild ${guildId}`);
            try {
              await Promise.race([
                entersState(queue.connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(queue.connection, VoiceConnectionStatus.Connecting, 5_000),
              ]);
              logger.info(`Attempting to reconnect in guild ${guildId}`);
            } catch (error) {
              logger.info(`Cleaning up connection in guild ${guildId}`);
              cleanupQueue(guildId, client);
            }
          });

          queue.connection.on(VoiceConnectionStatus.Destroyed, () => {
            logger.info(`Voice connection destroyed in guild ${guildId}`);
            cleanupQueue(guildId, client);
          });

          queue.player = createAudioPlayer({
            behaviors: { noSubscriber: 'play' }
          });

          queue.connection.subscribe(queue.player);
          setupPlayerListeners(guildId, queue, channel, client);
          client.queues.set(guildId, queue);
        } catch (error) {
          logger.error(`Failed to join voice channel ${voiceChannel.name} in guild ${guildId}:`, error);
          throw new Error('Failed to join voice channel. Please try again.');
        }
      } else {
        logger.info(`Reusing existing connection in guild ${guildId}, state: ${queue.connection.state.status}`);
      }

      queue.songs = tracks.map(track => ({
        ...track,
        requestedBy: member.displayName,
        requester: member
      }));

      if (shouldShuffle) {
        queue.songs = queue.songs
          .map(value => ({ value, sort: Math.random() }))
          .sort((a, b) => a.sort - b.sort)
          .map(({ value }) => value);
      }

      startDownloadQueue(guildId, queue, client);

      if (!queue.playing) {
        queue.playing = true;
        await playSong(guildId, queue, channel, client);
      }

      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('⚔️ Sabaton 24/7 Mode Activated!')
        .setDescription(
          `Prepare for battle with Sabaton!\n` +
          `Playing: ${selectedAlbum === 'all' ? 'All Albums' : selectedAlbum}\n` +
          `Volume: ${volume}%\n` +
          `Shuffle: ${shouldShuffle ? 'On' : 'Off'}`
        )
        .addFields(
          {
            name: 'Queue Info',
            value: `${queue.songs.length} songs in queue\nTotal duration: ${formatDuration(queue.songs.reduce((acc, song) => acc + song.duration, 0))}`,
            inline: true
          },
          {
            name: 'Settings',
            value: `Volume: ${Math.round(queue.volume * 100)}%\n` +
                   `Loop: ${queue.repeatMode}\n` +
                   `Effects: ${Object.entries(queue.effects)
                     .filter(([, enabled]) => enabled)
                     .map(([effect]) => effect)
                     .join(', ') || 'None'}`,
            inline: true
          }
        )
        .setFooter({ text: `Requested by ${member.displayName}`, iconURL: member.user.displayAvatarURL() });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error(`Sabaton24-7 command error in guild ${guildId}:`, error);
      await interaction.editReply(`There was an error starting the Sabaton playlist: ${error.message}. Please try again later.`);
      cleanupQueue(guildId, client);
    }
  }
};

async function downloadSong(song, guildId, queue, client) {
  if (song.isLive) return Promise.resolve();

  const searchQuery = `${song.title} ${song.author} ${song.album} official audio`;
  const searchResult = await ytSearch(searchQuery);
  if (!searchResult.videos.length) {
    logger.error(`No YouTube video found for "${song.title}" in guild ${guildId}`);
    throw new Error(`No YouTube video found for "${song.title}"`);
  }
  song.url = searchResult.videos[0].url;

  const videoId = extractVideoId(song.url);
  const filePath = path.join(AUDIO_DIR, `${videoId}.mp3`);

  if (await fs.access(filePath).then(() => true).catch(() => false)) {
    song.filePath = filePath;
    logger.music(`Reusing existing file "${song.title}" at ${filePath} for guild ${guildId}`);
    return Promise.resolve();
  }

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
    logger.info(`No songs left in queue for guild ${guildId}, restarting playlist`);
    cleanupQueue(guildId, client);
    return;
  }

  const song = queue.songs[0];

  try {
    if (!song.filePath) {
      logger.music(`Waiting for download of "${song.title}" in guild ${guildId}`);
      await downloadSong(song, guildId, queue, client);
    }

    if (!song.filePath || !(await fs.access(song.filePath).then(() => true).catch(() => false))) {
      throw new Error('Failed to download song or file not found');
    }

    const resource = createAudioResource(song.filePath, {
      inlineVolume: true,
      inputType: 'mp3'
    });
    resource.volume.setVolume(queue.volume);

    queue.player.play(resource);
    queue.playing = true;

    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('⚔️ Now Playing')
      .setDescription(`[${song.title}](${song.url})`)
      .addFields(
        { name: 'Artist', value: song.author, inline: true },
        { name: 'Album', value: song.album || 'Unknown', inline: true },
        { name: 'Duration', value: formatDuration(song.duration), inline: true }
      )
      .setFooter({ text: `Requested by ${song.requestedBy}`, iconURL: song.requester?.user?.displayAvatarURL() || null });

    channel.send({ embeds: [embed] }).catch(logger.error);

  } catch (error) {
    logger.error(`Error playing song "${song.title}" in guild ${guildId}:`, error);
    channel.send({ content: `Failed to play "${song.title}": ${error.message}. Skipping...` });
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
    queue.songs.shift();
    if (finishedSong) {
      queue.songs.push(finishedSong);
      logger.info(`Moving "${finishedSong.title}" to end of queue in guild ${guildId}`);
    }

    client.queues.set(guildId, queue);
    await playSong(guildId, queue, channel, client);
  });

  queue.player.on('error', (error) => {
    const song = queue.songs[0] || { title: 'Unknown' };
    logger.error(`Player error for "${song.title}" in guild ${guildId}:`, error.message);
    if (!queue.isSkipping) {
      channel.send({ content: `Player error: ${error.message}, skipping...` });
      skipSong(guildId, queue, channel, client);
    }
  });
}

function skipSong(guildId, queue, channel, client) {
  if (queue.player && queue.playing) {
    queue.isSkipping = true;
    queue.player.stop();
    logger.info(`Stopped player for guild ${guildId}`);
  }
  const skippedSong = queue.songs.shift();
  if (skippedSong) queue.songs.push(skippedSong);
  client.queues.set(guildId, queue);

  logger.info(`After skip, queue in guild ${guildId}: ${JSON.stringify(queue.songs.map(s => s.title))}`);
  if (queue.songs.length) {
    logger.info(`Skipping to next song in guild ${guildId}, queue length: ${queue.songs.length}`);
    playSong(guildId, queue, channel, client);
  } else {
    cleanupQueue(guildId, client);
  }
}

function cleanupQueue(guildId, client) {
  const queue = client.queues.get(guildId);
  if (queue) {
    if (queue.connection) {
      queue.connection.destroy();
    }
    if (queue.player) {
      queue.player.stop();
    }
    if (queue.liveProcess) {
      try {
        queue.liveProcess.kill('SIGTERM');
      } catch (error) {
        logger.error(`Failed to kill live process in guild ${guildId}:`, error);
      }
    }
    client.queues.delete(guildId);
    logger.info(`Cleaned up queue for guild ${guildId} (audio files retained)`);
  }
}

function extractVideoId(url) {
  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  return url.match(regExp)?.[1] || null;
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