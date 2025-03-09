const logger = require('../utils/logger');

module.exports = {
    name: 'inviteCreate',
    async execute(invite, client) {
        try {
            // Store the new invite in the guild's invite cache
            const guildInvites = client.settings.get(`${invite.guild.id}:invites`) || {};
            guildInvites[invite.code] = {
                code: invite.code,
                uses: 0,
                maxUses: invite.maxUses,
                inviterId: invite.inviter?.id,
                createdTimestamp: invite.createdTimestamp
            };
            client.settings.set(`${invite.guild.id}:invites`, guildInvites);
            
            logger.info(`New invite created in guild ${invite.guild.id} by user ${invite.inviter?.id}`);
        } catch (error) {
            logger.error(`Error handling invite creation: ${error.message}`);
        }
    }
}; 