const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member, client) {
    try {
      // Get leave message settings
      const settings = client.settings.get(`${member.guild.id}:leavemessage`);
      if (!settings) return; // No leave message configured

      // Get the channel
      const channel = member.guild.channels.cache.get(settings.channelId);
      if (!channel) {
        logger.error(`Leave channel ${settings.channelId} not found in guild ${member.guild.id}`);
        return;
      }

      // Generate leave message
      const leaveMessage = {
        text: settings.text,
        user: {
          id: member.id,
          username: member.user.username,
          createdTimestamp: member.user.createdTimestamp,
          joinedTimestamp: member.joinedTimestamp || Date.now()
        },
        guild: member.guild,
        options: {
          showJoinDate: settings.showJoinDate,
          showDuration: settings.showDuration,
          showMemberCount: settings.showMemberCount
        }
      };

      // Get the preview from leaveservermessage command
      const leaveCommand = client.commands.get('leaveservermessage');
      if (!leaveCommand) {
        logger.error(`leaveservermessage command not found for guild ${member.guild.id}`);
        return;
      }

      const messageContent = leaveCommand.generatePreview(
        leaveMessage.text,
        leaveMessage.user,
        leaveMessage.guild,
        leaveMessage.options
      );

      if (settings.useEmbed) {
        const embed = new EmbedBuilder()
          .setDescription(messageContent)
          .setColor(settings.color || '#FF4500')
          .setTimestamp();

        if (settings.image) {
          embed.setImage(settings.image);
        }

        await channel.send({ embeds: [embed] });
      } else {
        await channel.send({ content: messageContent });
      }

      logger.info(`Sent leave message for ${member.user.tag} in guild ${member.guild.id}`);
    } catch (error) {
      logger.error(`Error sending leave message in guild ${member.guild.id}:`, error);
    }
  }
}; 