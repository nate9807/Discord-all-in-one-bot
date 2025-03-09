const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invites')
        .setDescription('View invite statistics')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View your invite statistics'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('leaderboard')
                .setDescription('View the server\'s invite leaderboard'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('View invite statistics for a specific user')
                .addUserOption(option =>
                    option.setName('target')
                        .setDescription('The user to check invites for')
                        .setRequired(true))),
    cooldown: 5,
    async execute(interaction, client) {
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand();
        const guildInvites = await interaction.guild.invites.fetch();
        
        // Get cached invites for the guild
        const cachedInvites = client.settings.get(`${interaction.guild.id}:invites`) || {};
        
        switch (subcommand) {
            case 'view': {
                const userInvites = guildInvites.filter(invite => invite.inviter?.id === interaction.user.id);
                const totalInvites = userInvites.reduce((acc, invite) => acc + (invite.uses || 0), 0);
                const cachedUserInvites = Object.values(cachedInvites)
                    .filter(invite => invite.inviterId === interaction.user.id)
                    .reduce((acc, invite) => acc + (invite.uses || 0), 0);

                const embed = new EmbedBuilder()
                    .setTitle('Your Invite Statistics')
                    .setColor('#00ff00')
                    .addFields(
                        { name: 'Active Invites', value: userInvites.size.toString(), inline: true },
                        { name: 'Total Invites', value: (totalInvites + cachedUserInvites).toString(), inline: true }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                break;
            }
            case 'leaderboard': {
                // Combine current and cached invites
                const inviteStats = new Map();

                // Add current invites
                guildInvites.forEach(invite => {
                    if (!invite.inviter) return;
                    const userId = invite.inviter.id;
                    inviteStats.set(userId, (inviteStats.get(userId) || 0) + (invite.uses || 0));
                });

                // Add cached invites
                Object.values(cachedInvites).forEach(invite => {
                    if (!invite.inviterId) return;
                    inviteStats.set(invite.inviterId, (inviteStats.get(invite.inviterId) || 0) + (invite.uses || 0));
                });

                // Sort users by total invites
                const sortedInvites = [...inviteStats.entries()]
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 10);

                // Fetch all users first
                const userPromises = sortedInvites.map(([userId]) => client.users.fetch(userId).catch(() => null));
                const users = await Promise.all(userPromises);

                // Build the leaderboard text
                let description = '';
                for (let i = 0; i < sortedInvites.length; i++) {
                    const [userId, invites] = sortedInvites[i];
                    const user = users[i];
                    if (user) {
                        description += `${i + 1}. ${user.tag}: **${invites}** invites\n`;
                    } else {
                        description += `${i + 1}. Unknown User: **${invites}** invites\n`;
                    }
                }

                const embed = new EmbedBuilder()
                    .setTitle('Invite Leaderboard')
                    .setColor('#00ff00')
                    .setDescription(description || 'No invites found.')
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                break;
            }
            case 'user': {
                const targetUser = interaction.options.getUser('target');
                const userInvites = guildInvites.filter(invite => invite.inviter?.id === targetUser.id);
                const totalInvites = userInvites.reduce((acc, invite) => acc + (invite.uses || 0), 0);
                const cachedUserInvites = Object.values(cachedInvites)
                    .filter(invite => invite.inviterId === targetUser.id)
                    .reduce((acc, invite) => acc + (invite.uses || 0), 0);

                const embed = new EmbedBuilder()
                    .setTitle(`Invite Statistics for ${targetUser.tag}`)
                    .setColor('#00ff00')
                    .addFields(
                        { name: 'Active Invites', value: userInvites.size.toString(), inline: true },
                        { name: 'Total Invites', value: (totalInvites + cachedUserInvites).toString(), inline: true }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                break;
            }
        }
    },
}; 