const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember, client) {
    try {
      // Only proceed if nickname changed
      if (oldMember.nickname === newMember.nickname) return;

      // Get mod log channel from settings
      const settings = client.settings.get(`${newMember.guild.id}:modlog`);
      if (!settings?.channelId) return;

      const channel = newMember.guild.channels.cache.get(settings.channelId);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setAuthor({ 
          name: `${newMember.user.tag} - Nickname Update`, 
          iconURL: newMember.user.displayAvatarURL() 
        })
        .setColor('#4B0082')
        .setDescription(`
          **Old Nickname:** ${oldMember.nickname || '*None*'}
          **New Nickname:** ${newMember.nickname || '*None*'}
        `)
        .setFooter({ text: `Member ID: ${newMember.id}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      logger.info(`Logged nickname change for ${newMember.user.tag} in guild ${newMember.guild.id}`);
    } catch (error) {
      logger.error(`Error logging nickname change in guild ${newMember?.guild?.id}:`, error);
    }
  }
}; 