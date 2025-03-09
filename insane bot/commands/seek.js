const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getVoiceConnection, createAudioResource } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const { formatDuration } = require('./play.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Jump to a specific time in the current song')
    .addStringOption(option =>
      option.setName('timestamp')
        .setDescription('Time to seek to (e.g. 1:30, 1:30:00, or 90)')
        .setRequired(true)),
  cooldown: 3,
  async execute(interaction, client) {
    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    if (!queue || !queue.songs.length) {
      return interaction.reply({ content: 'Nothing is playing right now!', ephemeral: true });
    }

    if (!interaction.member.voice.channel) {
      return interaction.reply({ content: 'You need to be in a voice channel to use this command!', ephemeral: true });
    }

    const currentSong = queue.songs[0];
    if (currentSong.isLive) {
      return interaction.reply({ content: 'Cannot seek in a livestream!', ephemeral: true });
    }

    const timestamp = interaction.options.getString('timestamp');
    let seconds = 0;

    // Parse timestamp (accepts "1:30:00", "1:30", and "90" formats)
    if (timestamp.includes(':')) {
      const parts = timestamp.split(':').map(num => parseInt(num));
      if (parts.length === 3) { // HH:MM:SS
        seconds = (parts[0] * 3600) + (parts[1] * 60) + parts[2];
      } else if (parts.length === 2) { // MM:SS
        seconds = (parts[0] * 60) + parts[1];
      }
    } else {
      seconds = parseInt(timestamp);
    }

    if (isNaN(seconds) || seconds < 0 || seconds >= currentSong.duration) {
      return interaction.reply({
        content: `Invalid timestamp! Please provide a time between 0:00 and ${formatDuration(currentSong.duration)}.`,
        ephemeral: true
      });
    }

    try {
      await interaction.deferReply();

      // Create a new stream starting from the specified timestamp
      const stream = ytdl(currentSong.url, {
        filter: 'audioonly',
        quality: 'highestaudio',
        begin: seconds + 's',
        highWaterMark: 1 << 25
      });

      const resource = createAudioResource(stream, { inlineVolume: true });
      resource.volume.setVolume(queue.volume);
      
      queue.player.play(resource);
      queue.currentPosition = seconds;

      const embed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('Seeked')
        .setDescription(`Jumped to ${formatDuration(seconds)} in **${currentSong.title}**`)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      await interaction.editReply({ content: `Failed to seek: ${error.message}`, ephemeral: true });
    }
  },
}; 