const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the current queue.'),
  cooldown: 3,
  async execute(interaction, client) {
    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    if (!queue || !queue.songs.length) {
      return interaction.reply({ content: 'There are no songs in the queue to shuffle!', ephemeral: true });
    }

    if (!interaction.member.voice.channel) {
      return interaction.reply({ content: 'You need to be in a voice channel to shuffle the queue!', ephemeral: true });
    }

    if (queue.songs.length < 2) {
      return interaction.reply({ content: 'Need at least 2 songs in the queue to shuffle!', ephemeral: true });
    }

    // Keep the current song, shuffle the rest
    const currentSong = queue.songs[0];
    const remainingSongs = queue.songs.slice(1);

    // Fisher-Yates shuffle algorithm
    for (let i = remainingSongs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remainingSongs[i], remainingSongs[j]] = [remainingSongs[j], remainingSongs[i]];
    }

    queue.songs = [currentSong, ...remainingSongs];
    client.queues.set(guildId, queue);

    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle('Queue Shuffled')
      .setDescription(`Successfully shuffled ${remainingSongs.length} songs!`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
}; 