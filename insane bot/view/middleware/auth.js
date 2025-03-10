const createAuthMiddleware = (manager) => {
    const checkPermissions = async (userId, requireAdmin = false) => {
        const results = await manager.broadcastEval(async (client, { userId, requireAdmin }) => {
            try {
                const guilds = client.guilds.cache;
                console.log(`Checking ${guilds.size} guilds`);

                for (const [guildId, guild] of guilds) {
                    try {
                        const member = await guild.members.fetch({ user: userId, force: true })
                            .catch(e => {
                                console.log(`Could not fetch member in guild ${guildId}:`, e.message);
                                return null;
                            });

                        if (!member) continue;

                        const permissions = member.permissions.toArray();
                        const isOwner = guild.ownerId === userId;
                        const isAdmin = permissions.includes('Administrator');
                        const hasManageGuild = permissions.includes('ManageGuild');
                        const hasManageMessages = permissions.includes('ManageMessages');

                        // For mod dashboard, require admin permissions
                        if (requireAdmin && !isOwner && !isAdmin) {
                            continue;
                        }

                        // For music dashboard, just need to be in the server
                        return {
                            id: member.id,
                            username: member.user.username,
                            discriminator: member.user.discriminator,
                            avatar: member.user.displayAvatarURL({ dynamic: true }),
                            roles: Array.from(member.roles.cache.values())
                                .filter(role => role.name !== '@everyone')
                                .map(role => ({
                                    id: role.id,
                                    name: role.name,
                                    permissions: role.permissions.toArray()
                                })),
                            isOwner,
                            isAdmin,
                            permissions,
                            guildId,
                            guildName: guild.name
                        };
                    } catch (error) {
                        console.error(`Error checking guild ${guildId}:`, error.message);
                    }
                }
                return null;
            } catch (err) {
                console.error('Error in permission check:', err.message);
                return null;
            }
        }, { context: { userId, requireAdmin } });

        return Array.isArray(results) ? results.find(r => r !== null) : null;
    };

    const isAuthenticated = (requireAdmin = false) => async (req, res, next) => {
        try {
            // Check if user is authenticated via session
            if (!req.session?.user) {
                console.log('No user session found, redirecting to login');
                return res.redirect('/login');
            }

            const user = req.session.user;
            console.log('Checking permissions for user:', user.id);

            const userInfo = await checkPermissions(user.id, requireAdmin);

            if (!userInfo) {
                console.log(`No valid permissions found for user ${user.id}`);
                const message = requireAdmin 
                    ? 'You need to be a server administrator to access this dashboard.'
                    : 'You need to be a member of the server to access this dashboard.';
                return res.status(403).json({ 
                    error: 'Insufficient permissions',
                    details: message
                });
            }

            // Store guild info in session
            req.session.selectedGuildId = userInfo.guildId;
            req.session.selectedGuildName = userInfo.guildName;

            // Attach user info to request
            req.user = userInfo;
            console.log(`Successfully authenticated user ${user.id} for guild ${userInfo.guildId}`);
            next();
        } catch (err) {
            console.error('Error in auth middleware:', err);
            res.status(500).json({ 
                error: 'Internal server error',
                details: 'An error occurred while checking permissions.'
            });
        }
    };

    return { 
        isAuthenticated,
        requireAdmin: () => isAuthenticated(true),
        requireUser: () => isAuthenticated(false)
    };
};

module.exports = createAuthMiddleware; 