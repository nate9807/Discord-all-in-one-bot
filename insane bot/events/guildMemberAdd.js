const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    try {
      // Get welcome message settings
      const settings = client.settings.get(`${member.guild.id}:joinmessage`);
      if (!settings) return; // No welcome message configured

      // Get the channel
      const channel = member.guild.channels.cache.get(settings.channelId);
      if (!channel) {
        logger.error(`Welcome channel ${settings.channelId} not found in guild ${member.guild.id}`);
        return;
      }

      // Generate welcome message
      const welcomeMessage = {
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
          showAccountAge: settings.showAccountAge,
          showMemberCount: settings.showMemberCount
        }
      };

      // Get the preview from joinservermessage command
      const joinCommand = client.commands.get('joinservermessage');
      if (!joinCommand) {
        logger.error(`joinservermessage command not found for guild ${member.guild.id}`);
        return;
      }

      const messageContent = joinCommand.generatePreview(
        welcomeMessage.text,
        welcomeMessage.user,
        welcomeMessage.guild,
        welcomeMessage.options
      );

      if (settings.useEmbed) {
        const embed = new EmbedBuilder()
          .setDescription(messageContent)
          .setColor(settings.color || '#00FF00')
          .setTimestamp();

        if (settings.image) {
          embed.setImage(settings.image);
        }

        await channel.send({ embeds: [embed] });
      } else {
        await channel.send({ content: messageContent });
      }

      logger.info(`Sent welcome message for ${member.user.tag} in guild ${member.guild.id}`);

      // Fetch the guild's invites before and after the member joined
      const guildInvites = await member.guild.invites.fetch();
      const cachedInvites = client.settings.get(`${member.guild.id}:invites`) || {};

      // Find the invite that was used
      let usedInvite = null;
      for (const [code, invite] of guildInvites) {
        const cachedInvite = cachedInvites[code];
        if (cachedInvite && invite.uses > cachedInvite.uses) {
          usedInvite = invite;
          break;
        }
      }

      if (usedInvite) {
        // Update the cached invite
        cachedInvites[usedInvite.code] = {
          code: usedInvite.code,
          uses: usedInvite.uses,
          maxUses: usedInvite.maxUses,
          inviterId: usedInvite.inviter?.id,
          createdTimestamp: usedInvite.createdTimestamp
        };
        client.settings.set(`${member.guild.id}:invites`, cachedInvites);

        logger.info(`Member ${member.user.tag} joined using invite code ${usedInvite.code} from ${usedInvite.inviter?.tag}`);
      } else {
        logger.warn(`Could not determine which invite was used for member ${member.user.tag}`);
      }
    } catch (error) {
      logger.error(`Error sending welcome message in guild ${member.guild.id}:`, error);
    }
  }
}; 