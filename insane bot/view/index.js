require('dotenv').config();
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const os = require('os');
const logger = require('../utils/logger'); // Assuming logger is available in this path
const createAuthMiddleware = require('./middleware/auth');
const NodeCache = require('node-cache');
const userCache = new NodeCache({ stdTTL: 60 }); // Cache for 1 minute

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
    secret: process.env.SESSION_SECRET || 'your-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH ? true : false,
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    
    // Initialize auth middleware with the manager
    const { requireAdmin, requireUser } = createAuthMiddleware(manager);
    
    // Initialize admin auth middleware
    const isAdminAuthenticated = (req, res, next) => {
        if (!req.session.user) return res.redirect('/login');
        const guildId = req.query.guildId || req.body.guildId || req.session.selectedGuildId || process.env.GUILD_ID;
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

    let server;
    const port = process.env.WEB_PORT || 3000;

    // Check if SSL certificates are provided
    if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH && 
        fs.existsSync(process.env.SSL_KEY_PATH) && fs.existsSync(process.env.SSL_CERT_PATH)) {
        // Create HTTPS server
        const options = {
            key: fs.readFileSync(process.env.SSL_KEY_PATH),
            cert: fs.readFileSync(process.env.SSL_CERT_PATH)
        };
        server = https.createServer(options, app);
        logger.info('Starting dashboard with HTTPS');
    } else {
        // Create HTTP server if no SSL certificates
        const http = require('http');
        server = http.createServer(app);
        logger.info('Starting dashboard with HTTP (no SSL certificates found)');
    }

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

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'landing.html'));
    });

    // Add redirect from /mod to /mod-dashboard
    app.get('/mod', (req, res) => {
        res.redirect('/mod-dashboard');
    });

    app.get('/mod-dashboard', requireAdmin(), (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'mod-dashboard.html'));
    });

    // Serve static files for mod dashboard
    app.get('/mod-dashboard.css', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'mod-dashboard.css'));
    });

    app.get('/mod-dashboard.js', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'script.js'));
    });

    app.get('/api/stats', isAdminAuthenticated, async (req, res) => {
        try {
            const guildId = req.session.selectedGuildId;
            const data = await manager.broadcastEval(async (client, { guildId }) => {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) return null;
                return {
                    members: guild.memberCount,
                    channels: guild.channels.cache.size,
                    roles: guild.roles.cache.size
                };
            }, { context: { guildId } });
            res.json(data.find(d => d) || { error: 'Guild not found' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch stats' });
            logger.error('Stats endpoint error:', error);
        }
    });

    app.get('/api/recent-actions', isAdminAuthenticated, async (req, res) => {
        try {
            const guildId = req.session.selectedGuildId;
            const data = await manager.broadcastEval(async (client, { guildId }) => {
                return client.modLog?.get(guildId) || [];
            }, { context: { guildId } });
            res.json({ actions: data.flat().slice(-50) });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch recent actions' });
            logger.error('Recent actions endpoint error:', error);
        }
    });

    app.post('/api/mod/*', requireAdmin(), async (req, res) => {
        // Handle mod API endpoints
        // ... existing mod API handling code ...
    });

    // Quick actions endpoints
    app.post('/api/lockdown', isAdminAuthenticated, async (req, res) => {
        try {
            const { reason } = req.body;
            const guildId = req.session.selectedGuildId;

            const result = await manager.broadcastEval(async (client, { guildId, reason }) => {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) return { error: 'Guild not found' };

                try {
                    // Get all text channels
                    const channels = guild.channels.cache.filter(c => c.type === 'GUILD_TEXT');
                    
                    // Lock each channel
                    for (const [_, channel] of channels) {
                        await channel.permissionOverwrites.edit(guild.roles.everyone, {
                            SEND_MESSAGES: false
                        });
                    }

                    return { success: true, message: 'Server locked down' };
                } catch (err) {
                    return { error: err.message };
                }
            }, { context: { guildId, reason } });

            const response = result[0];
            if (response.error) {
                return res.status(400).json({ error: response.error });
            }
            res.json(response);
        } catch (err) {
            console.error('Error in lockdown:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/clear-chat', isAdminAuthenticated, async (req, res) => {
        try {
            const { channelId, amount } = req.body;
            const guildId = req.session.selectedGuildId;

            const result = await manager.broadcastEval(async (client, { guildId, channelId, amount }) => {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) return { error: 'Guild not found' };

                const channel = guild.channels.cache.get(channelId);
                if (!channel) return { error: 'Channel not found' };

                try {
                    const messages = await channel.bulkDelete(amount);
                    return { success: true, message: `Deleted ${messages.size} messages` };
                } catch (err) {
                    return { error: err.message };
                }
            }, { context: { guildId, channelId, amount } });

            const response = result[0];
            if (response.error) {
                return res.status(400).json({ error: response.error });
            }
            res.json(response);
        } catch (err) {
            console.error('Error in clear chat:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/voice-mute-all', isAdminAuthenticated, async (req, res) => {
        try {
            const { reason } = req.body;
            const guildId = req.session.selectedGuildId;

            const result = await manager.broadcastEval(async (client, { guildId, reason }) => {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) return { error: 'Guild not found' };

                try {
                    // Get all members in voice channels
                    const voiceMembers = guild.members.cache.filter(member => member.voice.channel);
                    
                    // Mute each member
                    for (const [_, member] of voiceMembers) {
                        await member.voice.setMute(true, reason);
                    }

                    return { success: true, message: 'All users muted' };
                } catch (err) {
                    return { error: err.message };
                }
            }, { context: { guildId, reason } });

            const response = result[0];
            if (response.error) {
                return res.status(400).json({ error: response.error });
            }
            res.json(response);
        } catch (err) {
            console.error('Error in voice mute all:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/voice-unmute-all', isAdminAuthenticated, async (req, res) => {
        try {
            const guildId = req.session.selectedGuildId;

            const result = await manager.broadcastEval(async (client, { guildId }) => {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) return { error: 'Guild not found' };

                try {
                    // Get all members in voice channels
                    const voiceMembers = guild.members.cache.filter(member => member.voice.channel && member.voice.mute);
                    
                    // Unmute each member
                    for (const [_, member] of voiceMembers) {
                        await member.voice.setMute(false);
                    }

                    return { success: true, message: 'All users unmuted' };
                } catch (err) {
                    return { error: err.message };
                }
            }, { context: { guildId } });

            const response = result[0];
            if (response.error) {
                return res.status(400).json({ error: response.error });
            }
            res.json(response);
        } catch (err) {
            console.error('Error in voice unmute all:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Music dashboard routes - require basic user authentication
    app.get(['/music', '/music-dashboard'], requireUser(), (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'music-dashboard.html'));
    });

    // Music API endpoints
    app.get('/api/music/now-playing', requireUser(), async (req, res) => {
        try {
            const data = await manager.broadcastEval((client, { userId }) => {
                const queue = client.queues.get(client.guilds.cache.first()?.id);
                if (!queue || !queue.songs.length) return null;
                
                const currentSong = queue.songs[0];
                return {
                    track: {
                        title: currentSong.title,
                        artist: currentSong.author,
                        duration: currentSong.duration,
                        currentTime: queue.player?.state?.playbackDuration || 0,
                        thumbnail: currentSong.thumbnail,
                        requestedBy: currentSong.requestedBy
                    },
                    isPlaying: queue.playing,
                    canControl: currentSong.requestedBy === userId || client.isAdmin(userId)
                };
            }, { context: { userId: req.session.user.id } });
            res.json(data.find(d => d) || { track: null, isPlaying: false, canControl: false });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch now playing' });
            logger.error('Now playing endpoint error:', error);
        }
    });

    // Update other music endpoints to use /api/music prefix
    app.get('/api/music/queue', requireUser(), async (req, res) => {
        try {
            const data = await manager.broadcastEval((client, { userId }) => {
                const queue = client.queues.get(client.guilds.cache.first()?.id);
                if (!queue || !queue.songs.length) return { queue: [] };
                
                // Skip the first song as it's the currently playing one
                const queueSongs = queue.songs.slice(1);
                return {
                    queue: queueSongs.map(song => ({
                        title: song.title,
                        artist: song.author,
                        duration: song.duration,
                        requestedBy: song.requestedBy,
                        canControl: song.requestedBy === userId || client.isAdmin(userId)
                    }))
                };
            }, { context: { userId: req.session.user.id } });
            res.json(data.find(d => d) || { queue: [] });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch queue' });
            logger.error('Queue endpoint error:', error);
        }
    });

    app.post('/api/music/toggle-playback', requireUser(), async (req, res) => {
        try {
            const result = await manager.broadcastEval(client => {
                const queue = client.queues.get(client.guilds.cache.first()?.id);
                if (!queue || !queue.songs.length) return { error: 'No active player' };
                
                if (queue.playing) {
                    queue.player.pause();
                    queue.playing = false;
                } else {
                    queue.player.unpause();
                    queue.playing = true;
                }
                client.queues.set(client.guilds.cache.first()?.id, queue);
                return { isPlaying: queue.playing };
            });
            res.json(result.find(r => r.isPlaying !== undefined) || { error: 'Failed to toggle playback' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to toggle playback' });
            logger.error('Toggle playback endpoint error:', error);
        }
    });

    app.post('/api/music/volume', requireUser(), async (req, res) => {
        const { volume } = req.body;
        if (typeof volume !== 'number' || volume < 0 || volume > 100) {
            return res.status(400).json({ error: 'Invalid volume' });
        }
        try {
            await manager.broadcastEval((client, { volume }) => {
                const queue = client.queues.get(client.guilds.cache.first()?.id);
                if (queue && queue.player) {
                    queue.volume = volume / 100;
                    if (queue.player.state.resource) {
                        queue.player.state.resource.volume.setVolume(queue.volume);
                    }
                }
            }, { context: { volume } });
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to set volume' });
            logger.error('Volume endpoint error:', error);
        }
    });

    app.post('/api/music/add-to-queue', requireUser(), async (req, res) => {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'Query required' });
        try {
            const result = await manager.broadcastEval(async (client, { query, userId }) => {
                const guildId = client.guilds.cache.first()?.id;
                if (!guildId) return { error: 'No guild available' };
                
                const command = client.commands.get('play');
                if (!command) return { error: 'Play command not found' };
                
                try {
                    // Get the guild and member
                    const guild = client.guilds.cache.first();
                    const member = await guild.members.fetch(userId);
                    
                    // Create a mock interaction for search
                    const mockInteraction = {
                        guildId: guildId,
                        guild: guild,
                        member: member,
                        user: member.user,
                        channel: guild.channels.cache.find(c => c.type === 0),
                        options: {
                            getString: (name) => name === 'query' ? query : null,
                            getSubcommand: () => null
                        },
                        reply: async (msg) => {
                            if (typeof msg === 'string') {
                                return { content: msg };
                            }
                            return msg;
                        },
                        editReply: async (msg) => {
                            if (typeof msg === 'string') {
                                return { content: msg };
                            }
                            return msg;
                        },
                        deferReply: async () => ({ deferred: true }),
                        followUp: async (msg) => {
                            if (typeof msg === 'string') {
                                return { content: msg };
                            }
                            return msg;
                        },
                        isCommand: () => true,
                        isChatInputCommand: () => true,
                        commandName: 'play'
                    };

                    // Execute the play command directly
                    try {
                        await command.execute(mockInteraction, client);
                    } catch (error) {
                        logger.error('Play command error:', error);
                        return { error: 'Failed to execute play command: ' + error.message };
                    }

                    // Get the queue to check what was added
                    const queue = client.queues.get(guildId);
                    if (!queue || !queue.songs.length) {
                        return { error: 'Failed to add song to queue' };
                    }

                    // Get the last added song
                    const song = queue.songs[queue.songs.length - 1];
                    
                    return { 
                        success: true, 
                        track: { 
                            title: song.title,
                            artist: song.author,
                            duration: song.duration
                        } 
                    };
                } catch (error) {
                    return { error: error.message || 'Failed to add song' };
                }
            }, { context: { query, userId: req.session.user.id } });
            
            res.json(result.find(r => r.success) || result.find(r => r.error) || { error: 'Failed to add to queue' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to add to queue' });
            logger.error('Add to queue endpoint error:', error);
        }
    });

    app.post('/api/music/remove-from-queue', requireUser(), async (req, res) => {
        const { index } = req.body;
        if (index === undefined || typeof index !== 'number') {
            return res.status(400).json({ error: 'Valid queue index required' });
        }
        
        try {
            const result = await manager.broadcastEval(async (client, { index, userId }) => {
                const queue = client.queues.get(client.guilds.cache.first()?.id);
                if (!queue || !queue.songs.length) return { error: 'No active queue' };
                
                // Adjust index since we show queue without the current song
                const actualIndex = index + 1;
                
                // Check if index is valid
                if (actualIndex < 1 || actualIndex >= queue.songs.length) {
                    return { error: 'Invalid queue index' };
                }
                
                // Check permissions
                const song = queue.songs[actualIndex];
                if (song.requestedBy !== userId && !client.isAdmin(userId)) {
                    return { error: 'Not authorized to remove this song' };
                }
                
                // Remove the song
                queue.songs.splice(actualIndex, 1);
                return { success: true };
            }, { context: { index, userId: req.session.user.id } });
            
            res.json(result.find(r => r.success) || result.find(r => r.error) || { error: 'Failed to remove from queue' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to remove from queue' });
            logger.error('Remove from queue endpoint error:', error);
        }
    });

    app.post('/api/music/next', requireUser(), async (req, res) => {
        try {
            const result = await manager.broadcastEval(async (client, { userId }) => {
                const queue = client.queues.get(client.guilds.cache.first()?.id);
                if (!queue || !queue.songs.length) return { error: 'No active queue' };
                
                const currentSong = queue.songs[0];
                if (currentSong.requestedBy !== userId && !client.isAdmin(userId)) {
                    return { error: 'Not authorized to skip this song' };
                }

                // Use the skip command's functionality
                const command = client.commands.get('skip');
                if (!command) return { error: 'Skip command not found' };

                queue.isSkipping = true;
                if (queue.player) {
                    queue.player.stop();
                }
                if (queue.liveProcess) {
                    queue.liveProcess.kill('SIGTERM');
                    queue.liveProcess = null;
                }

                // Remove current song and add to history
                const skippedSong = queue.songs.shift();
                if (skippedSong && !skippedSong.isLive) {
                    queue.history.unshift(skippedSong);
                }

                // Start playing next song if queue not empty
                if (queue.songs.length > 0) {
                    const playCommand = client.commands.get('play');
                    if (!playCommand) return { error: 'Play command not found' };
                    await playCommand.playSong(client.guilds.cache.first()?.id, queue, null, client);
                } else {
                    queue.playing = false;
                    queue.isSkipping = false;
                    if (queue.connection && !queue.connection.state.status === 'destroyed') {
                        queue.connection.destroy();
                    }
                    client.queues.delete(client.guilds.cache.first()?.id);
                }

                return { success: true };
            }, { context: { userId: req.session.user.id } });
            res.json(result.find(r => r.success) || result.find(r => r.error) || { error: 'Failed to skip song' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to skip song' });
            logger.error('Next track endpoint error:', error);
        }
    });

    app.post('/api/music/previous', requireUser(), async (req, res) => {
        try {
            const result = await manager.broadcastEval(async (client, { userId }) => {
                const queue = client.queues.get(client.guilds.cache.first()?.id);
                if (!queue || !queue.songs.length) return { error: 'No active queue' };
                
                // Check permissions
                if (!client.isAdmin(userId)) {
                    return { error: 'Not authorized to go to previous song' };
                }
                
                // Check if there's a previous song
                if (!queue.history || queue.history.length === 0) {
                    return { error: 'No previous song available' };
                }
                
                // Get the most recent previous song
                const previousSong = queue.history[0];
                
                // Add current song to the beginning of the queue
                if (queue.songs[0]) {
                    queue.songs.unshift(queue.songs[0]);
                }
                
                // Set the previous song as current
                queue.songs[0] = previousSong;
                queue.history.shift(); // Remove the song from history
                
                // Stop current playback
                if (queue.player) {
                    queue.player.stop();
                }
                if (queue.liveProcess) {
                    queue.liveProcess.kill('SIGTERM');
                    queue.liveProcess = null;
                }

                // Start playing the previous song
                const playCommand = client.commands.get('play');
                if (!playCommand) return { error: 'Play command not found' };
                await playCommand.playSong(client.guilds.cache.first()?.id, queue, null, client);
                
                return { success: true };
            }, { context: { userId: req.session.user.id } });
            res.json(result.find(r => r.success) || result.find(r => r.error) || { error: 'Failed to go to previous song' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to go to previous song' });
            logger.error('Previous track endpoint error:', error);
        }
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

    app.get('/guilds', isAdminAuthenticated, async (req, res) => {
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
        const cacheKey = `users_${guildId}`;

        try {
            // Try to get from cache first
            let cachedData = userCache.get(cacheKey);
            if (cachedData) {
                return res.json(cachedData);
            }

            const guildData = await manager.broadcastEval(async (client, { guildId }) => {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) return null;

                try {
                    // Fetch all members with presence data
                    await guild.members.fetch({ withPresences: true, force: true });
                    
                    // Get all roles first
                    const roles = Array.from(guild.roles.cache.values())
                        .sort((a, b) => b.position - a.position)
                        .map(role => ({
                            id: role.id,
                            name: role.name,
                            color: role.hexColor !== '#000000' ? role.hexColor : null,
                            position: role.position,
                            permissions: role.permissions.toArray()
                        }));

                    // Map members with their roles
                    const members = Array.from(guild.members.cache.values()).map(member => ({
                        id: member.user.id,
                        username: member.user.username,
                        discriminator: member.user.discriminator,
                        avatar: member.user.avatar ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png` : null,
                        status: member.presence?.status || 'offline',
                        roles: member.roles.cache
                            .sort((a, b) => b.position - a.position)
                            .map(role => ({
                                id: role.id,
                                name: role.name,
                                color: role.hexColor !== '#000000' ? role.hexColor : null,
                                position: role.position,
                                permissions: role.permissions.toArray()
                            }))
                            .filter(role => role.name !== '@everyone'),
                        activity: member.presence?.activities[0] ? {
                            name: member.presence.activities[0].name,
                            type: member.presence.activities[0].type,
                            state: member.presence.activities[0].state
                        } : null,
                        joinedAt: member.joinedTimestamp,
                        isOwner: member.id === guild.ownerId,
                        isBoosting: member.premiumSince !== null,
                        nickname: member.nickname
                    }));

                    return {
                        members,
                        roles,
                        memberCount: guild.memberCount,
                        success: true
                    };
                } catch (err) {
                    console.error('Error fetching guild members:', err);
                    return { error: err.message };
                }
            }, { context: { guildId } });

            const data = guildData.find(d => d?.success) || { members: [], roles: [], memberCount: 0 };
            
            if (!data.success) {
                throw new Error('Failed to fetch users from any shard');
            }

            // Sort members by status and role position
            data.members.sort((a, b) => {
                const statusOrder = { online: 0, idle: 1, dnd: 2, offline: 3 };
                if (statusOrder[a.status] !== statusOrder[b.status]) {
                    return statusOrder[a.status] - statusOrder[b.status];
                }
                const aHighestRole = Math.max(...a.roles.map(r => r.position), 0);
                const bHighestRole = Math.max(...b.roles.map(r => r.position), 0);
                return bHighestRole - aHighestRole;
            });

            // Cache the result
            userCache.set(cacheKey, data);
            
            res.json(data);
        } catch (error) {
            console.error('Users endpoint error:', error);
            
            // If we have cached data and there's an error, return cached data
            const cachedData = userCache.get(cacheKey);
            if (cachedData) {
                console.log('Returning cached user data due to error');
                return res.json(cachedData);
            }
            
            res.status(500).json({ 
                error: 'Failed to fetch users',
                details: error.message
            });
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

    // Add a catch-all route for 404s
    app.use((req, res, next) => {
        if (req.accepts('html')) {
            res.status(404).send(`
                <html>
                    <head>
                        <title>404 - Page Not Found</title>
                        <style>
                            body {
                                font-family: Arial, sans-serif;
                                text-align: center;
                                padding-top: 50px;
                            }
                            h1 { color: #333; }
                            p { color: #666; }
                            a { color: #007bff; text-decoration: none; }
                            a:hover { text-decoration: underline; }
                        </style>
                    </head>
                    <body>
                        <h1>404 - Page Not Found</h1>
                        <p>The page you're looking for doesn't exist.</p>
                        <p><a href="/">Return to Home</a></p>
                    </body>
                </html>
            `);
            return;
        }
        res.status(404).json({ error: 'Not found' });
    });

    // Error handling middleware
    app.use((err, req, res, next) => {
        logger.error('Express error:', err);
        if (req.accepts('html')) {
            res.status(500).send(`
                <html>
                    <head>
                        <title>500 - Server Error</title>
                        <style>
                            body {
                                font-family: Arial, sans-serif;
                                text-align: center;
                                padding-top: 50px;
                            }
                            h1 { color: #dc3545; }
                            p { color: #666; }
                            a { color: #007bff; text-decoration: none; }
                            a:hover { text-decoration: underline; }
                        </style>
                    </head>
                    <body>
                        <h1>500 - Server Error</h1>
                        <p>Something went wrong on our end. Please try again later.</p>
                        <p><a href="/">Return to Home</a></p>
                    </body>
                </html>
            `);
            return;
        }
        res.status(500).json({ error: 'Internal server error' });
    });

    server.listen(port, () => {
        logger.info(`Dashboard listening on port ${port}`);
    });

    return app;
}

module.exports = { start };