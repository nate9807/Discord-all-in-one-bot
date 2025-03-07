const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const logger = require('../utils/logger');

// Same YouTube cookies from your play command
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
      // Stop the current playback if it's playing
      if (queue.player && queue.playing) {
        queue.player.stop();
        logger.info(`Stopped current playback in guild ${guildId}`);
      }

      const index = interaction.options.getInteger('index');
      if (index !== null && index >= 0 && index < queue.songs.length) {
        const skippedSongs = queue.songs.splice(0, index);
        if (queue.loop) queue.songs.push(...skippedSongs);
        queue.history.unshift(...skippedSongs.reverse());
        const embed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Skipped')
          .setDescription(`Skipped to **${queue.songs[0].title}**`)
          .setThumbnail(queue.songs[0].thumbnail)
          .addFields({ name: 'Author', value: queue.songs[0].author, inline: true })
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        if (queue.songs.length) await playSong(guildId, queue, channel, client);
        else queue.playing = false;
      } else {
        const skippedSong = queue.songs.shift();
        if (skippedSong) queue.history.unshift(skippedSong);
        if (queue.loop && skippedSong) queue.songs.push(skippedSong);
        const embed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Skipped')
          .setDescription(`Skipped **${skippedSong.title}**`)
          .setThumbnail(skippedSong.thumbnail)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        if (queue.songs.length) await playSong(guildId, queue, channel, client);
        else queue.playing = false; // Removed the second "Queue Ended" embed here
      }
      if (queue.history.length > 10) queue.history = queue.history.slice(0, 10);
      client.queues.set(guildId, queue);

    } catch (error) {
      logger.error('Skip command error:', error.message || error);
      await interaction.editReply({ content: `Failed to skip: ${error.message || 'Unknown error'}` });
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

    stream.on('error', (err) => {
      logger.error(`Stream error for "${song.title}" in guild ${guildId}:`, err.message);
    });

    const resource = createAudioResource(stream, { inlineVolume: true });
    resource.volume.setVolume(queue.volume);
    queue.player.play(resource);
    queue.playing = true;
    client.queues.set(guildId, queue);

    queue.player.once(AudioPlayerStatus.Idle, async () => {
      logger.info(`Playback of "${song.title}" finished in guild ${guildId}`);
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