const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember, client) {
    try {
      // Check if member started or stopped boosting
      const wasBooster = oldMember.premiumSince !== null;
      const isBooster = newMember.premiumSince !== null;
      
      if (wasBooster === isBooster) return; // No change in boost status

      // Get mod log channel from settings
      const settings = client.settings.get(`${newMember.guild.id}:modlog`);
      if (!settings?.channelId) return;

      const channel = newMember.guild.channels.cache.get(settings.channelId);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setAuthor({ 
          name: `${newMember.user.tag} - Server Boost`, 
          iconURL: newMember.user.displayAvatarURL() 
        })
        .setColor(isBooster ? '#FF73FA' : '#FF6B6B')
        .setDescription(
          isBooster
            ? `🎉 **${newMember.user.tag}** just boosted the server!\n\nServer is now at **${newMember.guild.premiumSubscriptionCount}** boosts!`
            : `💔 **${newMember.user.tag}** is no longer boosting the server.\n\nServer is now at **${newMember.guild.premiumSubscriptionCount}** boosts.`
        )
        .setFooter({ text: `Member ID: ${newMember.id}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      logger.info(`Logged boost status change for ${newMember.user.tag} in guild ${newMember.guild.id}`);
    } catch (error) {
      logger.error(`Error logging boost status in guild ${newMember?.guild?.id}:`, error);
    }
  }
}; 