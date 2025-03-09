const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume playing the current song'),
  cooldown: 3,
  async execute(interaction, client) {
    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    try {
      if (!queue || !queue.songs.length) {
        logger.warn(`Resume command failed: No active queue in guild ${guildId}`);
        return interaction.reply({ content: 'Nothing is in the queue to resume!', ephemeral: true });
      }

      if (!interaction.member.voice.channel) {
        logger.warn(`Resume command failed: User not in voice channel in guild ${guildId}`);
        return interaction.reply({ content: 'You need to be in a voice channel to resume!', ephemeral: true });
      }

      // Check if user is in the same channel as the bot
      const botVoiceChannel = queue.connection?.joinConfig?.channelId;
      if (botVoiceChannel && interaction.member.voice.channel.id !== botVoiceChannel) {
        logger.warn(`Resume command failed: User in different voice channel in guild ${guildId}`);
        return interaction.reply({ content: 'You need to be in the same voice channel as the bot!', ephemeral: true });
      }

      if (queue.playing) {
        logger.warn(`Resume command failed: Music already playing in guild ${guildId}`);
        return interaction.reply({ content: 'The music is already playing!', ephemeral: true });
      }

      queue.player.unpause();
      queue.playing = true;
      client.queues.set(guildId, queue);

      const currentSong = queue.songs[0];
      logger.music(`Resumed "${currentSong.title}" in guild ${guildId} by ${interaction.user.tag}`);

      const embed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('▶️ Resumed')
        .setDescription(`**${currentSong.title}** has been resumed.`)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error(`Resume command error in guild ${guildId}:`, error);
      await interaction.reply({ 
        content: 'Failed to resume the music. Please try again.',
        ephemeral: true 
      });
    }
  },
};