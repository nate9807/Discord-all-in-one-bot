require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const youtubedl = require('youtube-dl-exec');
const ytSearch = require('yt-search');
const SpotifyWebApi = require('spotify-web-api-node');
const logger = require('../utils/logger');
const { google } = require('googleapis');

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

// Spotify URL patterns
const SPOTIFY_PATTERNS = {
  TRACK: /^(?:https?:\/\/)?(?:open\.)?spotify\.com\/track\/([a-zA-Z0-9]+)(?:\?.*)?$/,
  ALBUM: /^(?:https?:\/\/)?(?:open\.)?spotify\.com\/album\/([a-zA-Z0-9]+)(?:\?.*)?$/,
  PLAYLIST: /^(?:https?:\/\/)?(?:open\.)?spotify\.com\/playlist\/([a-zA-Z0-9]+)(?:\?.*)?$/
};

async function execute(interaction, client) {
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
      return interaction.editReply({ content: 'Failed to join voice channel. Please try again.' });
    }
  }

  try {
    const query = interaction.options.getString('query');
    let songs = [];

    // Check if it's a Spotify URL
    const spotifyTrackMatch = query.match(SPOTIFY_PATTERNS.TRACK);
    const spotifyAlbumMatch = query.match(SPOTIFY_PATTERNS.ALBUM);
    const spotifyPlaylistMatch = query.match(SPOTIFY_PATTERNS.PLAYLIST);

    if (spotifyTrackMatch || spotifyAlbumMatch || spotifyPlaylistMatch) {
      try {
        // Initialize Spotify API client
        const spotifyApi = new SpotifyWebApi({
          clientId: process.env.SPOTIFY_CLIENT_ID,
          clientSecret: process.env.SPOTIFY_CLIENT_SECRET
        });

        // Get access token
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);

        if (spotifyTrackMatch) {
          // Handle single track
          const trackId = spotifyTrackMatch[1];
          const track = await spotifyApi.getTrack(trackId);
          songs.push({
            title: track.body.name,
            author: track.body.artists.map(artist => artist.name).join(', '),
            duration: track.body.duration_ms / 1000,
            thumbnail: track.body.album.images[0]?.url,
            isLive: false,
            requestedBy: interaction.user.tag,
            spotifyTrack: track.body
          });
        } else if (spotifyAlbumMatch) {
          // Handle album
          const albumId = spotifyAlbumMatch[1];
          const album = await spotifyApi.getAlbum(albumId);
          songs = album.body.tracks.items.map(track => ({
            title: track.name,
            author: track.artists.map(artist => artist.name).join(', '),
            duration: track.duration_ms / 1000,
            thumbnail: album.body.images[0]?.url,
            isLive: false,
            requestedBy: interaction.user.tag,
            spotifyTrack: track
          }));
        } else if (spotifyPlaylistMatch) {
          // Handle playlist
          const playlistId = spotifyPlaylistMatch[1];
          const playlist = await spotifyApi.getPlaylist(playlistId);
          songs = playlist.body.tracks.items
            .filter(item => item.track) // Filter out null tracks
            .map(item => ({
              title: item.track.name,
              author: item.track.artists.map(artist => artist.name).join(', '),
              duration: item.track.duration_ms / 1000,
              thumbnail: item.track.album.images[0]?.url,
              isLive: false,
              requestedBy: interaction.user.tag,
              spotifyTrack: item.track
            }));
        }

        // Add songs to queue
        queue.songs.push(...songs);
        client.queues.set(guildId, queue);

        const embed = new EmbedBuilder()
          .setColor('#1DB954')
          .setTitle(spotifyTrackMatch ? '🎵 Added to Queue' : '📑 Added Playlist to Queue')
          .setDescription(`Added ${songs.length} song${songs.length === 1 ? '' : 's'} to the queue from Spotify`)
          .addFields(
            { name: 'First Track', value: songs[0].title, inline: true },
            { name: 'Artist', value: songs[0].author, inline: true },
            { name: 'Total Duration', value: formatDuration(songs.reduce((acc, song) => acc + song.duration, 0)), inline: true }
          )
          .setThumbnail(songs[0].thumbnail)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        if (!queue.playing) {
          logger.music(`Starting playback for guild ${guildId}`);
          await playSong(guildId, queue, channel, client);
        }
        return;
      } catch (error) {
        logger.error(`Spotify API error in guild ${guildId}:`, error);
        throw new Error('Failed to process Spotify link. Please try again later.');
      }
    }

    // Handle YouTube URL or search
    if (ytdl.validateURL(query)) {
      try {
        const videoId = extractVideoId(query);
        const response = await youtube.videos.list({
          part: 'snippet,contentDetails,liveStreamingDetails',
          id: videoId
        });
        const video = response.data.items[0];
        if (!video) throw new Error('Video not found');

        const isLive = !!video.liveStreamingDetails;
        logger.music(`Video "${video.snippet.title}" isLive: ${isLive} in guild ${guildId}`);

        songs = [{
          title: video.snippet.title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          duration: isLive ? Infinity : parseDuration(video.contentDetails.duration),
          author: video.snippet.channelTitle,
          thumbnail: video.snippet.thumbnails.default?.url || null,
          isLive: isLive,
          requestedBy: interaction.user.tag
        }];
      } catch (error) {
        logger.error(`Failed to fetch video info in guild ${guildId}:`, error);
        throw new Error('Failed to fetch video information. Please try again.');
      }
    } else {
      try {
        logger.music(`Searching for: "${query}" in guild ${guildId}`);
        const result = await ytSearch(query);
        if (!result.videos.length) throw new Error('No results found');
        
        songs = [{
          title: result.videos[0].title,
          url: result.videos[0].url,
          duration: result.videos[0].duration.seconds,
          author: result.videos[0].author.name,
          thumbnail: result.videos[0].thumbnail,
          isLive: false,
          requestedBy: interaction.user.tag
        }];
      } catch (error) {
        logger.error(`Search failed in guild ${guildId}:`, error);
        throw new Error('Failed to search for the song. Please try again.');
      }
    }

    // Add songs to queue
    queue.songs.push(...songs);
    client.queues.set(guildId, queue);
    logger.music(`Added ${songs[0].isLive ? 'live stream' : 'song'} "${songs[0].title}" to queue in guild ${guildId} by ${songs[0].requestedBy}`);

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
    await interaction.editReply({ 
      content: `Failed to play: ${error.message || 'An unexpected error occurred'}. Please try again.`,
      ephemeral: true 
    });
  }
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
    
    // Handle Spotify tracks by searching YouTube
    if (song.spotifyTrack) {
      try {
        const searchQuery = `${song.title} ${song.author}`;
        logger.music(`Searching YouTube for Spotify track: "${searchQuery}" in guild ${guildId}`);
        
        const result = await ytSearch(searchQuery);
        if (!result.videos.length) {
          throw new Error(`No YouTube results found for "${searchQuery}"`);
        }
        
        song.url = result.videos[0].url;
        logger.music(`Found YouTube match: "${result.videos[0].title}" for Spotify track in guild ${guildId}`);
      } catch (error) {
        logger.error(`Failed to find YouTube match for Spotify track in guild ${guildId}:`, error);
        skipSong(guildId, queue, channel, client);
        return;
      }
    }

    // Validate URL before attempting to stream
    if (!song.url || !ytdl.validateURL(song.url)) {
      logger.error(`Invalid YouTube URL for "${song.title}" in guild ${guildId}`);
      skipSong(guildId, queue, channel, client);
      return;
    }

    if (song.isLive) {
      // Handle live streams differently
      try {
        const process = youtubedl.exec(song.url, {
          format: 'best',
          output: '-',
          quiet: true
        });
        stream = process.stdout;
        queue.liveProcess = process;
      } catch (error) {
        logger.error(`Failed to start live stream in guild ${guildId}:`, error);
        skipSong(guildId, queue, channel, client);
        return;
      }
    } else {
      // Handle regular videos
      try {
        // First attempt with ytdl-core
        try {
          stream = ytdl(song.url, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 25, // 32MB buffer
            requestOptions: {
              headers: {
                Cookie: process.env.YOUTUBE_COOKIE || '',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
              }
            }
          });

          // Set up error handler for the stream
          stream.on('error', async (error) => {
            logger.error(`Stream error for "${song.title}" in guild ${guildId}:`, error);
            
            // If it's a 403 error, try the fallback method
            if (error.message.includes('403') || error.message.includes('Status code: 403')) {
              logger.info(`Attempting fallback streaming method for "${song.title}" in guild ${guildId}`);
              
              try {
                // Try using youtube-dl as a fallback
                const process = youtubedl.exec(song.url, {
                  format: 'bestaudio/best',
                  output: '-',
                  quiet: true,
                  limitRate: '1M'
                });
                
                if (queue.player) {
                  const fallbackResource = createAudioResource(process.stdout, {
                    inlineVolume: true,
                    inputType: 'raw'
                  });
                  
                  fallbackResource.volume?.setVolume(queue.volume);
                  queue.player.play(fallbackResource);
                  
                  // Update queue with the process for cleanup
                  queue.liveProcess = process;
                  client.queues.set(guildId, queue);
                  
                  logger.info(`Successfully switched to fallback streaming for "${song.title}" in guild ${guildId}`);
                  
                  // Send message to channel about the fallback
                  if (channel) {
                    channel.send({
                      content: `⚠️ Encountered streaming issues with "${song.title}". Switched to alternative streaming method.`
                    }).catch(err => logger.error(`Failed to send fallback message: ${err.message}`));
                  }
                  
                  return; // Successfully switched to fallback
                }
              } catch (fallbackError) {
                logger.error(`Fallback streaming method failed for "${song.title}" in guild ${guildId}:`, fallbackError);
                // If fallback fails, skip the song
                skipSong(guildId, queue, channel, client);
                return;
              }
            } else {
              // For other errors, skip the song
              skipSong(guildId, queue, channel, client);
            }
          });
        } catch (ytdlError) {
          logger.error(`Failed to create ytdl stream for "${song.title}" in guild ${guildId}:`, ytdlError);
          
          // Try youtube-dl directly as fallback
          try {
            logger.info(`Attempting youtube-dl fallback for "${song.title}" in guild ${guildId}`);
            const process = youtubedl.exec(song.url, {
              format: 'bestaudio/best',
              output: '-',
              quiet: true,
              limitRate: '1M'
            });
            
            stream = process.stdout;
            queue.liveProcess = process;
            
            logger.info(`Successfully created youtube-dl stream for "${song.title}" in guild ${guildId}`);
            
            // Send message to channel about the fallback
            if (channel) {
              channel.send({
                content: `⚠️ Using alternative streaming method for "${song.title}".`
              }).catch(err => logger.error(`Failed to send fallback message: ${err.message}`));
            }
          } catch (fallbackError) {
            logger.error(`All streaming methods failed for "${song.title}" in guild ${guildId}:`, fallbackError);
            skipSong(guildId, queue, channel, client);
            return;
          }
        }
      } catch (error) {
        logger.error(`Failed to create stream for "${song.title}" in guild ${guildId}:`, error);
        skipSong(guildId, queue, channel, client);
        return;
      }
    }

    const resource = createAudioResource(stream, {
      inlineVolume: true,
      inputType: song.isLive ? 'raw' : 'webm/opus'
    });

    resource.volume?.setVolume(queue.volume);

    if (!queue.player) {
      queue.player = createAudioPlayer();
      setupPlayerListeners(guildId, queue, channel, client);
      queue.connection.subscribe(queue.player);
    }

    queue.player.play(resource);
    queue.playing = true;

    // Update queue in client
    client.queues.set(guildId, queue);

    // Send now playing message
    const embed = new EmbedBuilder()
      .setColor(song.isLive ? '#FF0000' : '#00FFFF')
      .setTitle(song.isLive ? '🔴 Now Streaming' : '🎵 Now Playing')
      .setDescription(`**${song.title}**${song.author ? ` by ${song.author}` : ''}`)
      .addFields(
        { 
          name: song.isLive ? 'Type' : 'Duration', 
          value: song.isLive ? 'LIVE' : formatDuration(song.duration), 
          inline: true 
        },
        { 
          name: 'Requested By', 
          value: song.requestedBy, 
          inline: true 
        }
      );

    if (song.thumbnail) {
      embed.setThumbnail(song.thumbnail);
    }

    if (channel) {
      channel.send({ embeds: [embed] }).catch(error => {
        logger.error(`Failed to send now playing message in guild ${guildId}:`, error);
      });
    }

  } catch (error) {
    logger.error(`Failed to play song "${song.title}" in guild ${guildId}:`, error);
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
    
    // Handle repeat modes
    if (queue.repeatMode === 'song') {
      // Keep the current song and replay it
      logger.info(`Repeating song "${finishedSong.title}" in guild ${guildId}`);
      await playSong(guildId, queue, channel, client);
      return;
    } else if (queue.repeatMode === 'queue' && queue.songs.length > 0) {
      // Move the finished song to the end of the queue
      queue.songs.shift();
      if (finishedSong) {
        queue.songs.push(finishedSong);
        logger.info(`Moving "${finishedSong.title}" to end of queue in guild ${guildId} (queue repeat mode)`);
      }
    } else {
      // Normal mode - remove the finished song
      queue.songs.shift();
    }

    // Add to history if it exists
    if (finishedSong) {
      queue.history.push(finishedSong);
      // Keep history limited to last 50 songs
      if (queue.history.length > 50) {
        queue.history.shift();
      }
    }

    client.queues.set(guildId, queue);
    await playSong(guildId, queue, channel, client);
  });

  queue.player.on('error', async (err) => {
    const song = queue.songs[0] || { title: 'Unknown' };
    logger.error(`Player error for "${song.title}" in guild ${guildId}:`, err.message);
    
    // Check if it's a 403 error
    if (err.message.includes('403') || err.message.includes('Status code: 403')) {
      logger.info(`Attempting to recover from 403 error for "${song.title}" in guild ${guildId}`);
      
      try {
        // Try using youtube-dl as a fallback
        const process = youtubedl.exec(song.url, {
          format: 'bestaudio/best',
          output: '-',
          quiet: true,
          limitRate: '1M'
        });
        
        const fallbackResource = createAudioResource(process.stdout, {
          inlineVolume: true,
          inputType: 'raw'
        });
        
        fallbackResource.volume?.setVolume(queue.volume);
        
        // Update queue with the process for cleanup
        queue.liveProcess = process;
        client.queues.set(guildId, queue);
        
        // Play with the fallback resource
        queue.player.play(fallbackResource);
        
        logger.info(`Successfully recovered from 403 error for "${song.title}" in guild ${guildId}`);
        
        // Send message to channel about the recovery
        if (channel) {
          channel.send({
            content: `⚠️ Encountered streaming issues with "${song.title}". Switched to alternative streaming method.`
          }).catch(err => logger.error(`Failed to send recovery message: ${err.message}`));
        }
        
        return; // Successfully recovered
      } catch (fallbackError) {
        logger.error(`Failed to recover from 403 error for "${song.title}" in guild ${guildId}:`, fallbackError);
        // If recovery fails, skip the song
        if (!queue.isSkipping) {
          channel.send({ content: `Failed to play "${song.title}" due to streaming restrictions. Skipping...` });
          skipSong(guildId, queue, channel, client);
        }
      }
    } else {
      // For other errors, skip the song
      if (!queue.isSkipping) {
        channel.send({ content: `Player error: ${err.message}, skipping...` });
        skipSong(guildId, queue, channel, client);
      }
    }
  });
}

function skipSong(guildId, queue, channel, client) {
  try {
    if (!queue) {
      logger.warn(`Attempted to skip song in non-existent queue for guild ${guildId}`);
      return;
    }

    queue.isSkipping = true;

    // Stop current playback
    if (queue.player) {
      queue.player.stop();
    }

    // Kill any live stream process
    if (queue.liveProcess) {
      try {
        queue.liveProcess.kill('SIGTERM');
      } catch (error) {
        logger.error(`Failed to kill live process in guild ${guildId}:`, error);
      }
      queue.liveProcess = null;
    }

    // Remove current song and add to history if not live
    const skippedSong = queue.songs.shift();
    if (skippedSong && !skippedSong.isLive) {
      if (!queue.history) queue.history = [];
      queue.history = [skippedSong, ...queue.history].slice(0, 50); // Keep last 50 songs
    }

    // Update queue in client
    client.queues.set(guildId, queue);

    // If there are more songs, play the next one
    if (queue.songs.length > 0) {
      logger.music(`Skipping to next song in guild ${guildId}`);
      playSong(guildId, queue, channel, client);
    } else {
      logger.music(`No more songs in queue after skip in guild ${guildId}`);
      cleanupQueue(guildId, client);
    }
  } catch (error) {
    logger.error(`Error in skipSong for guild ${guildId}:`, error);
    // Try to clean up anyway
    cleanupQueue(guildId, client);
  } finally {
    queue.isSkipping = false;
  }
}

function cleanupQueue(guildId, client) {
  try {
    const queue = client.queues.get(guildId);
    if (!queue) return;

    // Stop playback
    if (queue.player) {
      queue.player.stop();
      queue.player = null;
    }

    // Kill any live stream process
    if (queue.liveProcess) {
      try {
        queue.liveProcess.kill('SIGTERM');
      } catch (error) {
        logger.error(`Failed to kill live process during cleanup in guild ${guildId}:`, error);
      }
      queue.liveProcess = null;
    }

    // Destroy connection
    if (queue.connection) {
      try {
        queue.connection.destroy();
      } catch (error) {
        logger.error(`Failed to destroy connection in guild ${guildId}:`, error);
      }
    }

    // Clear queue
    queue.songs = [];
    queue.playing = false;
    queue.isSkipping = false;

    // Remove from client queues
    client.queues.delete(guildId);
    
    logger.music(`Cleaned up queue for guild ${guildId}`);
  } catch (error) {
    logger.error(`Error in cleanupQueue for guild ${guildId}:`, error);
  }
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return 'Unknown';
  if (seconds === Infinity) return 'LIVE';
  
  // Ensure seconds is a number and round to nearest integer
  seconds = Math.round(Number(seconds));
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  // Format with leading zeros
  const formattedMinutes = minutes.toString().padStart(2, '0');
  const formattedSeconds = secs.toString().padStart(2, '0');
  
  // Only include hours if there are any
  if (hours > 0) {
    return `${hours}:${formattedMinutes}:${formattedSeconds}`;
  } else {
    return `${minutes}:${formattedSeconds}`;
  }
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