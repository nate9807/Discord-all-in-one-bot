require('dotenv').config();
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const os = require('os');
const logger = require('../utils/logger'); // Assuming logger is available in this path

const app = express();

// Validate environment variables
if (!process.env.CLIENT_ID || !/^\d+$/.test(process.env.CLIENT_ID)) {
    logger.error('CLIENT_ID is missing or invalid in .env. Please set a valid Discord snowflake.');
    process.exit(1);
}

if (!process.env.CLIENT_SECRET) {
    logger.error('CLIENT_SECRET is missing in .env. Please set it and try again.');
    process.exit(1);
}

if (!process.env.REDIRECT_URI) {
    logger.error('REDIRECT_URI is missing in .env. Please set it and try again.');
    process.exit(1);
}

if (!process.env.WEB_PORT) {
    logger.warn('WEB_PORT not set in .env. Defaulting to 3000.');
    process.env.WEB_PORT = '3000';
}

// SSL options (these could also be moved to .env if paths vary)
const options = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH || 'update for hardcoded locations'),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH || 'update for hardcoded locations')
};

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'update for hardcoded secret', // Allow override via .env
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.static(path.join(process.env.STATIC_FILES_PATH || 'update for hardcoded locations')));

// Authentication middleware
const isAuthenticated = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

const isAdminAuthenticated = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    const guildId = req.query.guildId || req.body.guildId || req.session.selectedGuildId || process.env.GUILD_ID || 'update for hardcoded guild id';
    checkAdmin(req.session.user.id, guildId)
        .then(isAdmin => {
            if (isAdmin) {
                req.session.selectedGuildId = guildId;
                next();
            } else {
                res.status(403).send('You do not have admin permissions in this server.');
            }
        })
        .catch(err => {
            logger.error('Error checking admin permissions:', err);
            res.status(500).send('Internal server error');
        });
};

let manager;

async function checkAdmin(userId, guildId) {
    const result = await manager.broadcastEval(async (client, { userId, guildId }) => {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return null;
        try {
            const member = await guild.members.fetch(userId);
            return member.permissions.has('ADMINISTRATOR');
        } catch {
            return false;
        }
    }, { context: { userId, guildId } });
    
    const adminResults = result.filter(r => r !== null);
    if (adminResults.length === 0) {
        logger.error(`Guild ${guildId} not found on any shard`);
        return false;
    }
    return adminResults.some(r => r === true);
}

function start(shardingManager) {
    manager = shardingManager;

    app.get('/login', (req, res) => {
        const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify guilds`;
        res.redirect(authUrl);
    });

    app.get('/auth/callback', async (req, res) => {
        const code = req.query.code;
        if (!code) return res.send('No code provided');
        try {
            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: process.env.CLIENT_ID,
                    client_secret: process.env.CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: process.env.REDIRECT_URI,
                    scope: 'identify guilds'
                })
            });
            const tokenData = await tokenResponse.json();
            if (!tokenData.access_token) throw new Error('No access token');
            const userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });
            const userData = await userResponse.json();
            req.session.user = userData;
            req.session.accessToken = tokenData.access_token;
            res.redirect('/');
        } catch (error) {
            res.send('Authentication failed');
            logger.error('Auth callback error:', error);
        }
    });

    app.get('/', isAdminAuthenticated, (req, res) => {
        res.sendFile(path.join(process.env.STATIC_FILES_PATH || '/var/www/mizmix-bot/view/public', 'dashboard.html'));
    });

    app.get('/health', isAdminAuthenticated, async (req, res) => {
        try {
            const cpus = os.cpus();
            const cpuUsage = cpus.map(cpu => cpu.times.user / (cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq) * 100);
            res.json({
                status: 'Online',
                uptime: Math.floor(process.uptime()),
                shards: manager.totalShards,
                memory: {
                    used: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
                    total: (os.totalmem() / 1024 / 1024).toFixed(2)
                },
                cpu: {
                    cores: cpus.length,
                    usage: cpuUsage.reduce((a, b) => a + b, 0) / cpuUsage.length
                },
                system: {
                    load: os.loadavg()[0],
                    freeMem: (os.freemem() / 1024 / 1024).toFixed(2)
                }
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch health data' });
            logger.error('Health endpoint error:', error);
        }
    });

    app.get('/user', isAdminAuthenticated, (req, res) => {
        res.json(req.session.user);
    });

    app.get('/logout', (req, res) => {
        req.session.destroy(() => res.redirect('/login'));
    });

    app.get('/guilds', isAuthenticated, async (req, res) => {
        try {
            const guildData = await manager.broadcastEval(async client => {
                return client.guilds.cache.map(guild => ({
                    id: guild.id,
                    name: guild.name,
                    icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null
                }));
            });
            const guilds = guildData.flat().reduce((acc, guild) => {
                if (!acc.some(g => g.id === guild.id)) acc.push(guild);
                return acc;
            }, []);
            const adminGuilds = await Promise.all(guilds.map(async guild => {
                const isAdmin = await checkAdmin(req.session.user.id, guild.id);
                return isAdmin ? guild : null;
            }));
            res.json(adminGuilds.filter(g => g));
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch guilds' });
            logger.error('Guilds endpoint error:', error);
        }
    });

    const commandFiles = fs.readdirSync(path.join(__dirname, '../commands')).filter(file => file.endsWith('.js'));
    const commandList = commandFiles.map(file => file.replace('.js', ''));

    app.get('/commands', isAdminAuthenticated, (req, res) => {
        res.json(commandList);
    });

    app.post('/bot/command', isAdminAuthenticated, async (req, res) => {
        const { command } = req.body;
        if (!commandList.includes(command)) return res.status(400).json({ error: 'Invalid command' });
        try {
            const result = await manager.broadcastEval(async (client, { cmd }) => {
                const command = client.commands.get(cmd);
                if (!command) return { error: 'Command not found on this shard' };
                return { message: `Command "${cmd}" executed on shard ${client.shard.ids[0]}` };
            }, { context: { cmd: command } });
            res.json(result.find(r => r.message) || { error: 'No shards executed the command' });
        } catch (error) {
            res.status(500).json({ error: 'Command execution failed' });
            logger.error('Command endpoint error:', error);
        }
    });

    app.get('/users', isAdminAuthenticated, async (req, res) => {
        const guildId = req.session.selectedGuildId;
        try {
            const guildData = await manager.broadcastEval(async (client, { guildId }) => {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) return null;
                await guild.members.fetch({ force: true });
                const roles = guild.roles.cache.map(role => ({
                    id: role.id,
                    name: role.name,
                    position: role.position
                }));
                const members = guild.members.cache.map(member => ({
                    id: member.user.id,
                    username: member.user.username,
                    discriminator: member.user.discriminator,
                    avatar: member.user.avatar ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png` : null,
                    status: member.presence?.status || 'offline',
                    roles: member.roles.cache.map(role => ({ id: role.id, name: role.name, position: role.position })),
                    activity: member.presence?.activities[0]?.name ? `Playing ${member.presence.activities[0].name}` : null,
                    isOwner: member.id === guild.ownerId
                }));
                return { members, roles, memberCount: guild.memberCount };
            }, { context: { guildId } });
            const data = guildData.find(d => d) || { members: [], roles: [], memberCount: 0 };
            res.json({ members: data.members, roles: data.roles, totalMembers: data.memberCount });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch users' });
            logger.error('Users endpoint error:', error);
        }
    });

    app.post('/user/:action', isAdminAuthenticated, async (req, res) => {
        const { userId } = req.body;
        const action = req.params.action;
        const guildId = req.session.selectedGuildId;
        if (!['kick', 'ban'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
        try {
            const result = await manager.broadcastEval(async (client, { userId, action, guildId }) => {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) return { error: 'No guild found' };
                const member = await guild.members.fetch(userId);
                if (!member) return { error: 'Member not found' };
                if (action === 'kick') await member.kick('Kicked via dashboard');
                if (action === 'ban') await member.ban({ reason: 'Banned via dashboard' });
                return { message: `${action.charAt(0).toUpperCase() + action.slice(1)} successful for ${member.user.tag}` };
            }, { context: { userId, action, guildId } });
            res.json(result.find(r => r.message) || { error: 'Action failed' });
        } catch (error) {
            res.status(500).json({ error: `${action} failed` });
            logger.error('User action endpoint error:', error);
        }
    });

    app.get('/channels', isAdminAuthenticated, async (req, res) => {
        const guildId = req.session.selectedGuildId;
        try {
            const channelData = await manager.broadcastEval(async (client, { guildId }) => {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) return null;
                try {
                    await guild.channels.fetch();
                    const allChannels = guild.channels.cache;

                    const categories = allChannels
                        .filter(ch => ch.type === 4)
                        .map(ch => ({
                            id: ch.id.toString(),
                            name: ch.name,
                            position: ch.position || 0
                        }));

                    const channels = allChannels
                        .filter(ch => ch.isTextBased() && ch.type !== 4)
                        .map(ch => ({
                            id: ch.id.toString(),
                            name: ch.name,
                            position: ch.position || 0,
                            categoryId: ch.parentId ? ch.parentId.toString() : null
                        }));

                    return { categories, channels };
                } catch (err) {
                    logger.error('Error fetching channels:', err);
                    return { error: 'Failed to fetch channels' };
                }
            }, { context: { guildId } });

            const data = channelData.find(d => d) || { categories: [], channels: [] };
            if (data.error) {
                res.status(500).json({ error: 'Failed to fetch channels' });
            } else {
                res.json(data);
            }
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch channels' });
            logger.error('Channels endpoint error:', error);
        }
    });

    app.get('/channel-messages/:channelId', isAdminAuthenticated, async (req, res) => {
        const channelId = req.params.channelId;
        const after = req.query.after || null;
        try {
            const messageData = await manager.broadcastEval(async (client, { channelId, after }) => {
                const channel = client.channels.cache.get(channelId);
                if (!channel || !channel.isTextBased()) return null;
                const options = { limit: 50 };
                if (after) options.after = after;
                const messages = await channel.messages.fetch(options);
                return messages.map(msg => ({
                    id: msg.id,
                    username: msg.author.username,
                    discriminator: msg.author.discriminator,
                    avatar: msg.author.avatar ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png` : null,
                    content: msg.content,
                    timestamp: msg.createdTimestamp
                })).reverse();
            }, { context: { channelId, after } });
            const messages = messageData.find(data => data)?.filter(Boolean) || [];
            res.json(messages);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch channel messages' });
            logger.error('Messages endpoint error:', error);
        }
    });

    app.post('/send-message', isAdminAuthenticated, async (req, res) => {
        const { channelId, message } = req.body;
        if (!channelId || !message) return res.status(400).json({ error: 'Channel ID and message required' });
        try {
            const result = await manager.broadcastEval(async (client, { channelId, message }) => {
                const channel = client.channels.cache.get(channelId);
                if (!channel || !channel.isTextBased()) return { error: 'Invalid channel' };
                await channel.send(message);
                return { message: 'Message sent successfully' };
            }, { context: { channelId, message } });
            res.json(result.find(r => r.message) || { error: 'Message send failed' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to send message' });
            logger.error('Send message endpoint error:', error);
        }
    });

    https.createServer(options, app).listen(process.env.WEB_PORT, () => {
        logger.info(`Web dashboard running on HTTPS port ${process.env.WEB_PORT}`);
    });
}

module.exports = { start };