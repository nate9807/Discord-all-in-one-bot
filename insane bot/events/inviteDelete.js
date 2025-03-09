const logger = require('../utils/logger');

module.exports = {
    name: 'inviteDelete',
    async execute(invite, client) {
        try {
            // Get the guild's invite cache
            const guildInvites = client.settings.get(`${invite.guild.id}:invites`) || {};
            
            // If the invite exists in our cache, remove it
            if (guildInvites[invite.code]) {
                delete guildInvites[invite.code];
                client.settings.set(`${invite.guild.id}:invites`, guildInvites);
                logger.info(`Invite ${invite.code} was deleted from guild ${invite.guild.id}`);
            }
        } catch (error) {
            logger.error(`Error handling invite deletion: ${error.message}`);
        }
    }
}; 