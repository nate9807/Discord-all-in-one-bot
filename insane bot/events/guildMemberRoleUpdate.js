const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember, client) {
    try {
      // Get mod log channel from settings
      const settings = client.settings.get(`${newMember.guild.id}:modlog`);
      if (!settings?.channelId) return;

      const channel = newMember.guild.channels.cache.get(settings.channelId);
      if (!channel) return;

      // Check if roles were changed
      const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
      const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

      if (addedRoles.size === 0 && removedRoles.size === 0) return;

      const embed = new EmbedBuilder()
        .setAuthor({ 
          name: `${newMember.user.tag} - Role Update`, 
          iconURL: newMember.user.displayAvatarURL() 
        })
        .setColor('#FFA500')
        .setTimestamp();

      const changes = [];
      
      if (addedRoles.size > 0) {
        changes.push(`**Added Roles:** ${addedRoles.map(r => `\`${r.name}\``).join(', ')}`);
      }
      
      if (removedRoles.size > 0) {
        changes.push(`**Removed Roles:** ${removedRoles.map(r => `\`${r.name}\``).join(', ')}`);
      }

      embed.setDescription(changes.join('\n'));
      embed.setFooter({ text: `Member ID: ${newMember.id}` });

      await channel.send({ embeds: [embed] });
      logger.info(`Logged role changes for ${newMember.user.tag} in guild ${newMember.guild.id}`);
    } catch (error) {
      logger.error(`Error logging role changes in guild ${newMember?.guild?.id}:`, error);
    }
  }
}; 