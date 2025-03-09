const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set the repeat mode for playback.')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('The repeat mode to set')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Current Song', value: 'song' },
          { name: 'Queue', value: 'queue' }
        )),
  cooldown: 3,
  async execute(interaction, client) {
    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    if (!queue || !queue.songs.length) {
      return interaction.reply({ content: 'Nothing is playing right now!', ephemeral: true });
    }

    if (!interaction.member.voice.channel) {
      return interaction.reply({ content: 'You need to be in a voice channel to change loop mode!', ephemeral: true });
    }

    const mode = interaction.options.getString('mode');
    queue.repeatMode = mode;
    client.queues.set(guildId, queue);

    const modeMessages = {
      'off': 'Repeat mode disabled',
      'song': 'Now repeating current song',
      'queue': 'Now repeating entire queue'
    };

    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle('Loop Mode Changed')
      .setDescription(modeMessages[mode])
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
}; 