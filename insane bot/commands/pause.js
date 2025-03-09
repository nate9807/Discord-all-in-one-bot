const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current song'),
  cooldown: 3,
  async execute(interaction, client) {
    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    try {
      if (!queue || !queue.songs.length) {
        logger.warn(`Pause command failed: No active queue in guild ${guildId}`);
        return interaction.reply({ content: 'Nothing is playing right now!', ephemeral: true });
      }

      if (!interaction.member.voice.channel) {
        logger.warn(`Pause command failed: User not in voice channel in guild ${guildId}`);
        return interaction.reply({ content: 'You need to be in a voice channel to pause!', ephemeral: true });
      }

      // Check if user is in the same channel as the bot
      const botVoiceChannel = queue.connection?.joinConfig?.channelId;
      if (botVoiceChannel && interaction.member.voice.channel.id !== botVoiceChannel) {
        logger.warn(`Pause command failed: User in different voice channel in guild ${guildId}`);
        return interaction.reply({ content: 'You need to be in the same voice channel as the bot!', ephemeral: true });
      }

      if (!queue.playing) {
        logger.warn(`Pause command failed: Music already paused in guild ${guildId}`);
        return interaction.reply({ content: 'The music is already paused!', ephemeral: true });
      }

      queue.player.pause();
      queue.playing = false;
      client.queues.set(guildId, queue);

      const currentSong = queue.songs[0];
      logger.music(`Paused "${currentSong.title}" in guild ${guildId} by ${interaction.user.tag}`);

      const embed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('⏸️ Paused')
        .setDescription(`**${currentSong.title}** has been paused.\nUse \`/resume\` to continue playing.`)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error(`Pause command error in guild ${guildId}:`, error);
      await interaction.reply({ 
        content: 'Failed to pause the music. Please try again.',
        ephemeral: true 
      });
    }
  },
};