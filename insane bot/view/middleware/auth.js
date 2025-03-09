const createAuthMiddleware = (manager) => {
    const isAuthenticated = (req, res, next) => {
        // Check if user is authenticated via session
        if (!req.session?.user) {
            console.log('No user session found, redirecting to login');
            return res.redirect('/login');
        }

        // Check if user has required permissions
        const user = req.session.user;
        console.log('Checking permissions for user:', user.id);

        // Verify user exists and has required permissions
        manager.broadcastEval(async (client, { userId }) => {
            try {
                // Get all guilds
                const guilds = client.guilds.cache;
                console.log(`Checking ${guilds.size} guilds`);

                for (const [guildId, guild] of guilds) {
                    try {
                        // Force fetch the member
                        const member = await guild.members.fetch({ user: userId, force: true })
                            .catch(e => {
                                console.log(`Could not fetch member in guild ${guildId}:`, e.message);
                                return null;
                            });

                        if (!member) continue;

                        // Get the member's permissions
                        const permissions = member.permissions.toArray();
                        console.log(`Permissions for user ${userId} in guild ${guildId}:`, permissions);

                        // Check if user has required permissions
                        const isOwner = guild.ownerId === userId;
                        const isAdmin = permissions.includes('Administrator');
                        const hasManageGuild = permissions.includes('ManageGuild');
                        const hasManageMessages = permissions.includes('ManageMessages');

                        console.log(`Permission check for ${userId} in ${guildId}:`, {
                            isOwner,
                            isAdmin,
                            hasManageGuild,
                            hasManageMessages
                        });

                        if (isOwner || isAdmin || (hasManageGuild && hasManageMessages)) {
                            console.log(`User ${userId} has sufficient permissions in guild ${guildId}`);
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
                                permissions,
                                guildId,
                                guildName: guild.name
                            };
                        }
                    } catch (error) {
                        console.error(`Error checking guild ${guildId}:`, error.message);
                    }
                }
                return null;
            } catch (err) {
                console.error('Error in permission check:', err.message);
                return null;
            }
        }, { context: { userId: user.id } })
        .then(results => {
            // Filter out null results and get the first valid one
            const userInfo = Array.isArray(results) ? results.find(r => r !== null) : null;
            
            if (!userInfo) {
                console.log(`No valid permissions found for user ${user.id}`);
                return res.status(403).json({ 
                    error: 'Insufficient permissions',
                    details: 'You need to be a server administrator or have Manage Server and Manage Messages permissions.'
                });
            }

            // Store guild info in session
            req.session.selectedGuildId = userInfo.guildId;
            req.session.selectedGuildName = userInfo.guildName;

            // Attach user info to request
            req.user = userInfo;
            console.log(`Successfully authenticated user ${user.id} for guild ${userInfo.guildId}`);
            next();
        })
        .catch(err => {
            console.error('Error in auth middleware:', err);
            res.status(500).json({ 
                error: 'Internal server error',
                details: 'An error occurred while checking permissions.'
            });
        });
    };

    return { isAuthenticated };
};

module.exports = createAuthMiddleware; 