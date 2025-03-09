const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set music volume.')
    .addIntegerOption(option => 
      option.setName('level')
        .setDescription('Volume (0-200)')
        .setMinValue(0)
        .setMaxValue(200)
        .setRequired(true)),
  cooldown: 3,
  async execute(interaction, client) {
    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);
    
    if (!queue || !queue.songs.length) {
      logger.warn(`Volume command failed: No active queue in guild ${guildId}`);
      return interaction.reply({ content: 'Nothing is playing right now!', ephemeral: true });
    }

    if (!interaction.member.voice.channel) {
      logger.warn(`Volume command failed: User not in voice channel in guild ${guildId}`);
      return interaction.reply({ content: 'You need to be in a voice channel to change the volume!', ephemeral: true });
    }

    // Check if user is in the same channel as the bot
    const botVoiceChannel = queue.connection?.joinConfig?.channelId;
    if (botVoiceChannel && interaction.member.voice.channel.id !== botVoiceChannel) {
      logger.warn(`Volume command failed: User in different voice channel in guild ${guildId}`);
      return interaction.reply({ content: 'You need to be in the same voice channel as the bot!', ephemeral: true });
    }

    const level = interaction.options.getInteger('level');
    const normalizedVolume = level / 100;
    const oldVolume = Math.round(queue.volume * 100);

    try {
      // Update queue volume
      queue.volume = normalizedVolume;
      client.queues.set(guildId, queue);

      // Update current resource volume if it exists
      if (queue.player?.state?.resource) {
        queue.player.state.resource.volume.setVolume(normalizedVolume);
        logger.music(`Volume changed from ${oldVolume}% to ${level}% in guild ${guildId} by ${interaction.user.tag}`);

        const embed = new EmbedBuilder()
          .setTitle('Volume Changed')
          .setDescription(`Volume changed from **${oldVolume}%** to **${level}%**`)
          .setColor('#00FFFF')
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      } else {
        logger.warn(`No active resource to update volume in guild ${guildId}`);
        await interaction.reply({ 
          content: 'Volume setting will be applied to the next song.',
          ephemeral: true 
        });
      }
    } catch (error) {
      logger.error(`Failed to change volume in guild ${guildId}:`, error);
      await interaction.reply({ 
        content: 'Failed to change volume. Please try again.',
        ephemeral: true 
      });
    }
  },
};