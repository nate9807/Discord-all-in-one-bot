require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const SpotifyWebApi = require('spotify-web-api-node');
const play = require('play-dl');
const ytdl = require('@distube/ytdl-core');
const logger = require('../utils/logger');

// Album names for search
const a7xAlbums = [
    'Sounding the Seventh Trumpet',
    'Waking the Fallen',
    'City of Evil',
    'Avenged Sevenfold',
    'Nightmare',
    'Hail to the King',
    'The Stage',
    'Life Is But a Dream...'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('a7x24-7')
        .setDescription('Plays Avenged Sevenfold music 24/7 in your voice channel')
        .addNumberOption(option =>
            option.setName('volume')
                .setDescription('Set the volume (0-100)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(100))
        .addBooleanOption(option =>
            option.setName('shuffle')
                .setDescription('Shuffle the playlist (default: true)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('album')
                .setDescription('Play a specific album')
                .addChoices(
                    { name: 'All Albums (Shuffle)', value: 'all' },
                    ...a7xAlbums.map(album => ({
                        name: album,
                        value: album
                    }))
                )
                .setRequired(false)),
    cooldown: 10,
    category: 'music',
    permissions: [
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak,
        PermissionsBitField.Flags.ViewChannel
    ],
    
    async execute(interaction, client) {
        // Check bot permissions first
        const botMember = interaction.guild.members.me;
        if (!botMember.permissions.has(this.permissions)) {
            return interaction.reply({
                content: 'I need permissions to join and speak in voice channels!',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const guildId = interaction.guild.id;
        const member = interaction.member;
        const channel = interaction.channel;
        const volume = interaction.options.getNumber('volume') || 50;
        const shouldShuffle = interaction.options.getBoolean('shuffle') ?? true;
        const selectedAlbum = interaction.options.getString('album') || 'all';

        if (!member.voice.channel) {
            logger.warn(`A7X24-7 command failed: User not in voice channel in guild ${guildId}`);
            return interaction.editReply({ 
                content: 'You need to be in a voice channel to use this command!',
                ephemeral: true 
            });
        }

        // Check if bot has permission to join the specific voice channel
        const voiceChannel = member.voice.channel;
        const permissions = voiceChannel.permissionsFor(botMember);
        if (!permissions.has([PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak])) {
            return interaction.editReply({
                content: `I don't have permission to join or speak in ${voiceChannel}!`,
                ephemeral: true
            });
        }

        try {
            // Initialize Spotify API client
            const spotifyApi = new SpotifyWebApi({
                clientId: process.env.SPOTIFY_CLIENT_ID,
                clientSecret: process.env.SPOTIFY_CLIENT_SECRET
            });

            // Get access token
            const data = await spotifyApi.clientCredentialsGrant();
            spotifyApi.setAccessToken(data.body['access_token']);

            // Initialize queue before any potential errors
            let queue = client.queues.get(guildId) || {
                connection: null,
                songs: [],
                volume: volume / 100,
                loop: true,
                playing: false,
                player: null,
                currentPosition: 0,
                initiator: member.id,
                history: [],
                repeatMode: 'all',
                liveProcess: null,
                isSkipping: false,
                effects: {
                    bassboost: false,
                    nightcore: false,
                    vaporwave: false
                }
            };

            // Get tracks based on selected album
            let tracks = [];
            try {
                if (selectedAlbum === 'all') {
                    // Get tracks from all albums
                    for (const albumName of a7xAlbums) {
                        const searchResults = await spotifyApi.searchAlbums(`album:${albumName} artist:Avenged Sevenfold`);
                        if (searchResults.body.albums.items.length > 0) {
                            const albumId = searchResults.body.albums.items[0].id;
                            const albumTracks = await spotifyApi.getAlbumTracks(albumId);
                            tracks.push(...albumTracks.body.items.map(track => ({
                                title: track.name,
                                author: 'Avenged Sevenfold',
                                album: albumName,
                                duration: track.duration_ms / 1000,
                                isLive: false,
                                spotifyTrack: track
                            })));
                        }
                    }
                } else {
                    // Search for specific album
                    const searchResults = await spotifyApi.searchAlbums(`album:${selectedAlbum} artist:Avenged Sevenfold`);
                    if (searchResults.body.albums.items.length > 0) {
                        const albumId = searchResults.body.albums.items[0].id;
                        const albumTracks = await spotifyApi.getAlbumTracks(albumId);
                        tracks = albumTracks.body.items.map(track => ({
                            title: track.name,
                            author: 'Avenged Sevenfold',
                            album: selectedAlbum,
                            duration: track.duration_ms / 1000,
                            isLive: false,
                            spotifyTrack: track
                        }));
                    }
                }
            } catch (spotifyError) {
                logger.error('Spotify API error:', spotifyError);
                throw new Error('Failed to fetch tracks from Spotify. Please try again later.');
            }

            if (!tracks.length) {
                throw new Error('No tracks found! Please try again later.');
            }

            // Create new connection if none exists
            if (!queue.connection) {
                try {
                    queue.connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: guildId,
                        adapterCreator: interaction.guild.voiceAdapterCreator,
                    });

                    queue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
                        logger.warn(`Disconnected from voice channel in guild ${guildId}`);
                        try {
                            await Promise.race([
                                entersState(queue.connection, VoiceConnectionStatus.Signalling, 5_000),
                                entersState(queue.connection, VoiceConnectionStatus.Connecting, 5_000),
                            ]);
                            logger.info(`Attempting to reconnect in guild ${guildId}`);
                        } catch (error) {
                            logger.info(`Cleaning up connection in guild ${guildId}`);
                            cleanupQueue(guildId, client);
                        }
                    });

                    queue.connection.on(VoiceConnectionStatus.Destroyed, () => {
                        logger.info(`Voice connection destroyed in guild ${guildId}`);
                        cleanupQueue(guildId, client);
                    });

                    queue.player = createAudioPlayer({
                        behaviors: { noSubscriber: 'play' }
                    });

                    queue.connection.subscribe(queue.player);
                    setupPlayerListeners(guildId, queue, channel, client);
                    client.queues.set(guildId, queue);
                    logger.info(`Joined voice channel in guild ${guildId}`);
                } catch (error) {
                    logger.error(`Failed to join voice channel in guild ${guildId}:`, error);
                    return interaction.editReply({ content: 'Failed to join voice channel. Please try again.' });
                }
            }

            // Prepare songs with metadata
            queue.songs = tracks.map(track => ({
                ...track,
                requestedBy: member.displayName,
                requester: member
            }));

            // Shuffle if requested
            if (shouldShuffle) {
                queue.songs = queue.songs
                    .map(value => ({ value, sort: Math.random() }))
                    .sort((a, b) => a.sort - b.sort)
                    .map(({ value }) => value);
            }

            // Start playing if not already
            if (!queue.playing) {
                queue.playing = true;
                await playSong(guildId, queue, channel, client);
            }

            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('🤘 A7X 24/7 Mode Activated!')
                .setDescription(
                    `Get ready to rock with Avenged Sevenfold!\n` +
                    `Playing: ${selectedAlbum === 'all' ? 'All Albums' : selectedAlbum}\n` +
                    `Volume: ${volume}%\n` +
                    `Shuffle: ${shouldShuffle ? 'On' : 'Off'}`
                )
                .addFields(
                    { 
                        name: 'Queue Info', 
                        value: `${queue.songs.length} songs in queue\nTotal duration: ${formatDuration(queue.songs.reduce((acc, song) => acc + song.duration, 0))}`, 
                        inline: true 
                    },
                    { 
                        name: 'Settings', 
                        value: `Volume: ${Math.round(queue.volume * 100)}%\n` +
                               `Loop: ${queue.repeatMode}\n` +
                               `Effects: ${Object.entries(queue.effects)
                                 .filter(([, enabled]) => enabled)
                                 .map(([effect]) => effect)
                                 .join(', ') || 'None'}`,
                        inline: true 
                    }
                )
                .setFooter({ text: `Requested by ${member.displayName}`, iconURL: member.user.displayAvatarURL() });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            logger.error('A7X24-7 command error:', error);
            await interaction.editReply('There was an error trying to start the A7X playlist! Please try again later.');
            
            cleanupQueue(guildId, client);
        }
    }
};

function setupPlayerListeners(guildId, queue, channel, client) {
    queue.player.on('stateChange', (oldState, newState) => {
        if (newState.status === AudioPlayerStatus.Playing) {
            logger.info(`Player state changed to Playing in guild ${guildId}`);
        }
    });

    queue.player.on(AudioPlayerStatus.Idle, async () => {
        if (queue.isSkipping) {
            queue.isSkipping = false;
            return;
        }

        const finishedSong = queue.songs[0];
        
        // Move the finished song to the end of the queue (for 24/7 mode)
        queue.songs.shift();
        if (finishedSong) {
            queue.songs.push(finishedSong);
            logger.info(`Moving "${finishedSong.title}" to end of queue in guild ${guildId}`);
        }

        client.queues.set(guildId, queue);
        await playSong(guildId, queue, channel, client);
    });

    queue.player.on('error', (error) => {
        const song = queue.songs[0] || { title: 'Unknown' };
        logger.error(`Player error for "${song.title}" in guild ${guildId}:`, error.message);
        if (!queue.isSkipping) {
            channel.send({ content: `Player error: ${error.message}, skipping...` });
            skipSong(guildId, queue, channel, client);
        }
    });
}

async function playSong(guildId, queue, channel, client) {
    try {
        if (!queue.songs.length) {
            // If no songs left, reshuffle the playlist
            queue.songs = queue.songs.sort(() => Math.random() - 0.5);
            if (!queue.songs.length) {
                cleanupQueue(guildId, client);
                return;
            }
        }

        const song = queue.songs[0];
        
        try {
            // Search for the song on YouTube
            const searchQuery = `${song.title} ${song.author} ${song.album} official audio`;
            const searchResult = await play.search(searchQuery, { limit: 1 });
            
            if (!searchResult || searchResult.length === 0) {
                throw new Error(`Could not find YouTube video for: ${song.title}`);
            }

            // Get the stream from YouTube
            const stream = ytdl(searchResult[0].url, {
                filter: 'audioonly',
                quality: 'highestaudio',
                highWaterMark: 1 << 25,
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': '*/*',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Origin': 'https://www.youtube.com',
                        'Referer': 'https://www.youtube.com/'
                    }
                }
            });

            if (!stream) throw new Error('Failed to initialize stream');

            logger.info(`Stream initialized for "${song.title}" in guild ${guildId}`);

            stream.on('error', (error) => {
                logger.error(`Stream error for "${song.title}" in guild ${guildId}:`, error);
                if (!queue.isSkipping) {
                    channel.send({ content: `Stream error: ${error.message}, skipping...` });
                    skipSong(guildId, queue, channel, client);
                }
            });

            const resource = createAudioResource(stream, {
                inlineVolume: true
            });
            resource.volume.setVolume(queue.volume);

            queue.player.play(resource);

            // Update song with YouTube URL
            song.url = searchResult[0].url;

            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('🎸 Now Playing')
                .setDescription(`[${song.title}](${song.url})`)
                .addFields(
                    { name: 'Artist', value: song.author, inline: true },
                    { name: 'Album', value: song.album, inline: true },
                    { name: 'Duration', value: formatDuration(song.duration), inline: true }
                )
                .setFooter({ text: `Requested by ${song.requestedBy}`, iconURL: song.requester.user.displayAvatarURL() });

            channel.send({ embeds: [embed] }).catch(logger.error);

        } catch (error) {
            logger.error(`Error with song "${song.title}": ${error.message}`);
            // Remove problematic song and try next one
            queue.songs.shift();
            return playSong(guildId, queue, channel, client);
        }

    } catch (error) {
        logger.error('Error playing song:', error);
        if (queue.songs.length > 0) {
            queue.songs.shift(); // Remove problematic song
            playSong(guildId, queue, channel, client);
        }
    }
}

function skipSong(guildId, queue, channel, client) {
    if (queue.player && queue.playing) {
        queue.isSkipping = true;
        queue.player.stop();
        logger.info(`Stopped player for guild ${guildId}`);
    }
    const skippedSong = queue.songs.shift();
    if (skippedSong) queue.songs.push(skippedSong); // For 24/7 mode, move to end
    client.queues.set(guildId, queue);

    logger.info(`After skip, queue in guild ${guildId}: ${JSON.stringify(queue.songs.map(s => s.title))}`);
    if (queue.songs.length) {
        logger.info(`Skipping to next song in guild ${guildId}, queue length: ${queue.songs.length}`);
        playSong(guildId, queue, channel, client);
    } else {
        cleanupQueue(guildId, client);
    }
}

function cleanupQueue(guildId, client) {
    const queue = client.queues.get(guildId);
    if (queue) {
        if (queue.connection) {
            queue.connection.destroy();
            logger.info(`Bot left voice channel in guild ${guildId}`);
        }
        client.queues.delete(guildId);
        logger.info(`Cleaned up queue for guild ${guildId}`);
    }
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
} 