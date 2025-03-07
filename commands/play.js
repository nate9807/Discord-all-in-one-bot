const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const ytSearch = require('yt-search');
const logger = require('../utils/logger');

const youtubeCookies = [
  { "name": "VISITOR_INFO1_LIVE", "value": "a5isiy6Tmog" },
  { "name": "VISITOR_PRIVACY_METADATA", "value": "CgJVUxIEGgAgKQ==" },
  { "name": "YSC", "value": "1N4VbUW3fsc" },
  { "name": "SID", "value": "g.a000twijwIoeIazWOcjhmW7G5DMLv7RPmYbXzSpgoftQY5--Trgjgxr1WnTB-drFjjWpizpwxAACgYKAWMSARISFQHGX2MiCygp3LcoSlNrH0X7P3WLdRoVAUF8yKrfrRWAShiqdxkND6A4HRZZ0076" },
  { "name": "__Secure-1PSID", "value": "g.a000twijwIoeIazWOcjhmW7G5DMLv7RPmYbXzSpgoftQY5--Trgjpo9f-lard2bOLjTu_SJXXwACgYKAVwSARISFQHGX2Mi4Vjkn-7TpNWaZNCIO6M88RoVAUF8yKrCHGbFf7fxoTs26PoRuuo10076" },
  { "name": "__Secure-3PSID", "value": "g.a000twijwIoeIazWOcjhmW7G5DMLv7RPmYbXzSpgoftQY5--TrgjlXqTj-jr0Uu-4xSLBhQIsAACgYKAbsSARISFQHGX2MiBS458EbTK3U-wM2NJwMs_RoVAUF8yKp5LJzD2Kb_0unsqmhS1ZIM0076" },
  { "name": "HSID", "value": "Azlh0UEeUkWBxyTpz" },
  { "name": "SSID", "value": "AMXN_BOFIUZyeNFz_" },
  { "name": "APISID", "value": "1SK6P2DXalthETeP/AIMPYiyinsB2de286" },
  { "name": "SAPISID", "value": "Q5phZqPKx8qVU93L/Av57oZMxbla3uw6Zd" },
  { "name": "__Secure-1PAPISID", "value": "Q5phZqPKx8qVU93L/Av57oZMxbla3uw6Zd" },
  { "name": "__Secure-3PAPISID", "value": "Q5phZqPKx8qVU93L/Av57oZMxbla3uw6Zd" },
  { "name": "LOGIN_INFO", "value": "AFmmF2swRQIgNQvltIQZdCnDe83h4KSWA9VY8jRTbL5XMSHqsNA1rhwCIQDybfipWcdWXeVLbbk5K10IIbooYMx-257HPUhhXRdUlg:QUQ3MjNmeVRRMlA4ZS1QVFdXWlpwbHpWRk1HcF9vaHp4a2tkdm9nLWJyTDRaOERZX0dfYVJpaGVGZVU2djJLaUdxaExuMzNsNldkNnZBeUtTTUtfZHVSSnNpOFpaR2NEV25PVV85QkpYN2s4UllDWGIxRUFhQkdKam1RQUQ5czh3RTV2blNxNHhMY0QtSmhMTUc1YXBMLTlkODAzM195THVn" },
  { "name": "PREF", "value": "repeat=NONE&volume=2&autoplay=true&tz=America.Indianapolis" },
  { "name": "__Secure-1PSIDTS", "value": "sidts-CjEBEJ3XV-kWzlA0EHMMqH8CSsl2pU3Chd0LvdvyrCUeHBSlo_XSg3su5IjhhAmQz-f0EAA" },
  { "name": "__Secure-3PSIDTS", "value": "sidts-CjEBEJ3XV-kWzlA0EHMMqH8CSsl2pU3Chd0LvdvyrCUeHBSlo_XSg3su5IjhhAmQz-f0EAA" },
  { "name": "SIDCC", "value": "AKEyXzVBYGEjIlPjzSq2BoebNmUfZb6pFkkDUVBdF_utJVFaHTMVenA5l7Dhnhn2rgFiydYGEDs" },
  { "name": "__Secure-1PSIDCC", "value": "AKEyXzW0TxfwHBg8hm7BUxph0ZB1V-Rla-YKrnjoqtbatw6JTmpNF0fAnef32tmFWMPqLpm-1w" },
  { "name": "__Secure-3PSIDCC", "value": "AKEyXzWl9OQbQdu_qjxbovFFaObv-RRFcQEd-ZJUZJjQaNmIPJSOGEOacvigoK_5JfgyLVUDdg" }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song from YouTube.')
    .addStringOption(option => option.setName('query').setDescription('YouTube URL or search term').setRequired(true)),
  cooldown: 5,
  async execute(interaction, client) {
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
      repeatMode: 'off'
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
      queue.player = createAudioPlayer();
      queue.connection.subscribe(queue.player);
      client.queues.set(guildId, queue);
      logger.info(`Joined voice channel in guild ${guildId}`);
    }

    try {
      const query = interaction.options.getString('query');
      let song;

      if (ytdl.validateURL(query)) {
        const info = await ytdl.getInfo(query, {
          requestOptions: {
            cookies: youtubeCookies,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
              'Accept': '*/*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Origin': 'https://www.youtube.com',
              'Referer': 'https://www.youtube.com/'
            }
          }
        });
        song = {
          title: info.videoDetails.title,
          url: info.videoDetails.video_url,
          duration: parseInt(info.videoDetails.lengthSeconds),
          author: info.videoDetails.author.name,
          thumbnail: info.videoDetails.thumbnails[0].url
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
          thumbnail: result.videos[0].thumbnail
        };
      }

      queue.songs.push(song);
      client.queues.set(guildId, queue);
      logger.info(`Added song "${song.title}" to queue in guild ${guildId}`);

      const embed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('Added to Queue')
        .setThumbnail(song.thumbnail)
        .setDescription(`**${song.title}** by ${song.author}`)
        .addFields(
          { name: 'Duration', value: formatDuration(song.duration), inline: true },
          { name: 'Position', value: `${queue.songs.length}`, inline: true }
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });

      if (!queue.playing) {
        logger.info(`Starting playback for guild ${guildId}`);
        await playSong(guildId, queue, channel, client);
      }

    } catch (error) {
      logger.error('Play command error:', error.message || error);
      await interaction.editReply({ content: `Failed to play song: ${error.message || 'Unknown error'}` });
    }
  },
};

async function playSong(guildId, queue, channel, client) {
  const song = queue.songs[0];
  if (!song) {
    queue.playing = false;
    client.queues.set(guildId, queue);
    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle('Queue Ended')
      .setDescription('The queue has finished playing.')
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    return;
  }

  try {
    const stream = ytdl(song.url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
      requestOptions: {
        cookies: youtubeCookies,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://www.youtube.com',
          'Referer': 'https://www.youtube.com/'
        }
      }
    });

    logger.info(`Stream initialized for "${song.title}" in guild ${guildId}`);

    // Minimal logging for errors only
    stream.on('error', (err) => {
      logger.error(`Stream error for "${song.title}" in guild ${guildId}:`, err.message);
    });

    const resource = createAudioResource(stream, { inlineVolume: true });
    resource.volume.setVolume(queue.volume);
    queue.player.play(resource);
    queue.playing = true;
    client.queues.set(guildId, queue);

    queue.player.on('stateChange', (oldState, newState) => {
      if (newState.status === 'playing') {
        logger.info(`Started playing "${song.title}" in guild ${guildId}`);
      }
    });

    queue.player.once(AudioPlayerStatus.Idle, async () => {
      logger.info(`Finished playing "${song.title}" in guild ${guildId}`);
      const finishedSong = queue.songs.shift();
      if (finishedSong) queue.history.unshift(finishedSong);
      if (queue.repeatMode === 'song' && finishedSong) {
        queue.songs.unshift(finishedSong);
      } else if (queue.repeatMode === 'queue' && finishedSong) {
        queue.songs.push(finishedSong);
      } else if (queue.loop && finishedSong) {
        queue.songs.push(finishedSong);
      }
      if (queue.history.length > 10) queue.history = queue.history.slice(0, 10);
      client.queues.set(guildId, queue);

      if (queue.songs.length) {
        await playSong(guildId, queue, channel, client);
      } else {
        queue.playing = false;
        client.queues.set(guildId, queue);
        const embed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Queue Ended')
          .setDescription('The queue has finished playing.')
          .setTimestamp();
        await channel.send({ embeds: [embed] });
      }
    });

    queue.player.on('error', err => {
      logger.error('Player error:', err.message);
      channel.send({ content: 'An error occurred while playing the song: ' + err.message });
      cleanupQueue(guildId, client);
    });

  } catch (error) {
    logger.error('Play song error:', error.message || error);
    channel.send({ content: `Failed to play "${song.title}": ${error.message || 'Unknown error'}` });
    queue.songs.shift();
    if (queue.songs.length) {
      await playSong(guildId, queue, channel, client);
    } else {
      queue.playing = false;
      client.queues.set(guildId, queue);
    }
  }
}

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

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}