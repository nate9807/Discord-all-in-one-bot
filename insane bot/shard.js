require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const logger = require('./utils/logger');

// Add process lock check
const SHARD_LOCK_FILE = path.join(__dirname, `.shard-${process.argv[2]}.lock`);

// Create shard lock file
async function createShardLock() {
    try {
        await fsPromises.writeFile(SHARD_LOCK_FILE, process.pid.toString());
    } catch (error) {
        logger.error(`Failed to create shard lock file: ${error.message}`);
    }
}

// Remove shard lock file
async function removeShardLock() {
    try {
        await fsPromises.unlink(SHARD_LOCK_FILE).catch(() => {});
    } catch (error) {
        logger.error(`Failed to remove shard lock file: ${error.message}`);
    }
}

// Check if this shard is already running
async function isShardRunning() {
    try {
        const pid = parseInt(await fsPromises.readFile(SHARD_LOCK_FILE, 'utf8'));
        try {
            process.kill(pid, 0);
            return true; // Process is running
        } catch (e) {
            await removeShardLock();
            return false;
        }
    } catch (e) {
        return false;
    }
}

// Audio and I/O error handler
const handleNonFatalError = (error, context) => {
  const nonFatalCodes = ['EPIPE', 'EIO', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'VOICE_CONNECTION_ERROR'];
  
  // Check if this is a non-fatal error
  const isNonFatal = nonFatalCodes.includes(error.code) || 
                     error.message?.includes('write after end') ||
                     error.message?.includes('voice connection');
  
  if (isNonFatal) {
    logger.warn(`Non-fatal ${context} error: ${error.message}`);
    return true; // Error was handled
  }
  
  // Pass through fatal errors
  return false;
};

// Create the client with necessary intents
let client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildModeration
    ],
    partials: [
        'USER',
        'CHANNEL',
        'GUILD_MEMBER',
        'MESSAGE',
        'REACTION',
        'GUILD_SCHEDULED_EVENT'
    ],
    allowedMentions: { parse: ['users', 'roles'], repliedUser: true },
    shardCount: process.env.SHARD_COUNT ? parseInt(process.env.SHARD_COUNT) : 'auto',
    shard: process.argv[2] ? [parseInt(process.argv[2]), parseInt(process.argv[3])] : undefined,
    // Improve error tolerance
    failIfNotExists: false,
    // Add retry mechanisms
    retryLimit: 5,
    restWsBridgeTimeout: 10000,
    restRequestTimeout: 15000
});

// Initialize collections
client.commands = new Collection();
client.cooldowns = new Collection();
client.settings = new Map();
client.queues = new Map();

// Add memory management
const checkMemoryUsage = () => {
    // Get memory configuration from environment variables or use defaults
    const memoryLimitMB = parseInt(process.env.MEMORY_LIMIT_MB) || 0; // 0 means no limit
    const memoryWarnThreshold = parseFloat(process.env.MEMORY_WARN_THRESHOLD) || 0.8; // 80% by default
    const memoryCriticalThreshold = parseFloat(process.env.MEMORY_CRITICAL_THRESHOLD) || 0.9; // 90% by default
    
    const used = process.memoryUsage();
    const heapUsed = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotal = Math.round(used.heapTotal / 1024 / 1024);
    const rss = Math.round(used.rss / 1024 / 1024);
    
    // If memory limit is set to 0, only log memory usage without warnings
    if (memoryLimitMB === 0) {
        // Log memory usage every 10 minutes for monitoring
        if (Date.now() % (10 * 60 * 1000) < 1000) {
            logger.info(`Memory usage - Heap: ${heapUsed}MB / ${heapTotal}MB (RSS: ${rss}MB) - No limit set`);
        }
        return;
    }
    
    // Calculate usage ratio against configured limit
    const usageRatio = memoryLimitMB > 0 ? rss / memoryLimitMB : heapUsed / heapTotal;
    
    // Log memory usage based on thresholds
    if (usageRatio > memoryCriticalThreshold) {
        logger.error(`CRITICAL memory usage - ${rss}MB / ${memoryLimitMB > 0 ? `${memoryLimitMB}MB limit` : `${heapTotal}MB heap`} (${Math.round(usageRatio * 100)}%)`);
        performMemoryCleanup(true); // Force aggressive cleanup
    } else if (usageRatio > memoryWarnThreshold) {
        logger.warn(`High memory usage - ${rss}MB / ${memoryLimitMB > 0 ? `${memoryLimitMB}MB limit` : `${heapTotal}MB heap`} (${Math.round(usageRatio * 100)}%)`);
        performMemoryCleanup(false); // Normal cleanup
    } else if (Date.now() % (10 * 60 * 1000) < 1000) {
        // Log normal memory usage every 10 minutes
        logger.info(`Memory usage - ${rss}MB / ${memoryLimitMB > 0 ? `${memoryLimitMB}MB limit` : `${heapTotal}MB heap`} (${Math.round(usageRatio * 100)}%)`);
    }
};

// Memory cleanup function
const performMemoryCleanup = (aggressive = false) => {
    try {
        logger.info(`Performing ${aggressive ? 'aggressive' : 'standard'} memory cleanup`);
        
        // Clear command cooldowns that are expired
        const now = Date.now();
        let cooldownsCleared = 0;
        for (const [commandName, timestamps] of client.cooldowns.entries()) {
            const initialSize = timestamps.size;
            for (const [userId, expireTime] of timestamps.entries()) {
                if (now > expireTime) {
                    timestamps.delete(userId);
                    cooldownsCleared++;
                }
            }
            // If no timestamps left for this command, remove the command entry
            if (timestamps.size === 0) {
                client.cooldowns.delete(commandName);
            }
        }
        
        // Trim music queue history if it's getting large
        let queueHistoryTrimmed = 0;
        for (const [guildId, queue] of client.queues.entries()) {
            if (queue && queue.history) {
                const initialLength = queue.history.length;
                // In aggressive mode, keep fewer items
                const keepItems = aggressive ? 10 : 50;
                if (initialLength > keepItems) {
                    queue.history = queue.history.slice(-keepItems);
                    queueHistoryTrimmed += (initialLength - queue.history.length);
                }
            }
        }
        
        // Clear any cached data that's not needed
        let cacheItemsCleared = 0;
        if (client.voiceManager && client.voiceManager.cache) {
            // Clear voice manager cache
            // In aggressive mode, clear all cache, otherwise only clear old entries
            if (aggressive) {
                cacheItemsCleared = Object.keys(client.voiceManager.cache).length;
                client.voiceManager.cache = {};
            } else {
                const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
                for (const [key, data] of Object.entries(client.voiceManager.cache)) {
                    if (data.timestamp && data.timestamp < thirtyMinutesAgo) {
                        delete client.voiceManager.cache[key];
                        cacheItemsCleared++;
                    }
                }
            }
        }
        
        // In aggressive mode, disconnect from idle voice channels
        let connectionsCleared = 0;
        if (aggressive && client.voice && client.voice.connections) {
            const connections = Array.from(client.voice.connections.values());
            for (const connection of connections) {
                // Check if connection is idle (no one in voice channel)
                const channel = connection.channel;
                if (channel && channel.members.size <= 1) { // Only bot in channel
                    connection.disconnect();
                    connectionsCleared++;
                }
            }
        }
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            logger.info('Forced garbage collection');
        }
        
        // Log memory after cleanup
        const afterCleanup = process.memoryUsage();
        const heapAfter = Math.round(afterCleanup.heapUsed / 1024 / 1024);
        const rssAfter = Math.round(afterCleanup.rss / 1024 / 1024);
        logger.info(`Memory after cleanup: ${heapAfter}MB heap, ${rssAfter}MB RSS. Cleared: ${cooldownsCleared} cooldowns, ${queueHistoryTrimmed} history items, ${cacheItemsCleared} cache items, ${connectionsCleared} connections`);
    } catch (error) {
        logger.error('Error during memory cleanup:', error);
    }
};

// Check memory usage with adaptive frequency
const adaptiveMemoryCheck = () => {
    // Get memory configuration from environment variables
    const memoryLimitMB = parseInt(process.env.MEMORY_LIMIT_MB) || 0;
    
    // If unlimited memory is enabled, just do minimal checks
    if (memoryLimitMB === 0) {
        // Only log memory usage occasionally without any cleanup
        const used = process.memoryUsage();
        const heapUsed = Math.round(used.heapUsed / 1024 / 1024);
        const heapTotal = Math.round(used.heapTotal / 1024 / 1024);
        const rss = Math.round(used.rss / 1024 / 1024);
        
        // Log memory usage every 30 minutes for monitoring
        if (Date.now() % (30 * 60 * 1000) < 1000) {
            logger.info(`Memory usage (unlimited mode) - Heap: ${heapUsed}MB / ${heapTotal}MB (RSS: ${rss}MB)`);
        }
        
        // Check again in 30 minutes
        setTimeout(adaptiveMemoryCheck, 30 * 60 * 1000);
        return;
    }
    
    // Normal memory check for limited mode
    checkMemoryUsage();
    
    // Get memory configuration from environment variables or use defaults
    const memoryCheckFrequency = parseInt(process.env.MEMORY_CHECK_FREQUENCY) || 0; // 0 means adaptive
    
    if (memoryCheckFrequency > 0) {
        // Use fixed frequency from environment variable (in seconds)
        setTimeout(adaptiveMemoryCheck, memoryCheckFrequency * 1000);
        return;
    }
    
    // Adjust check frequency based on current memory usage
    const used = process.memoryUsage();
    const heapUsed = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotal = Math.round(used.heapTotal / 1024 / 1024);
    const rss = Math.round(used.rss / 1024 / 1024);
    
    const usageRatio = memoryLimitMB > 0 ? rss / memoryLimitMB : heapUsed / heapTotal;
    
    let checkInterval;
    if (usageRatio > 0.9) {
        // Very high usage - check every minute
        checkInterval = 60000;
    } else if (usageRatio > 0.8) {
        // High usage - check every 2 minutes
        checkInterval = 120000;
    } else if (usageRatio > 0.7) {
        // Moderate usage - check every 3 minutes
        checkInterval = 180000;
    } else {
        // Normal usage - check every 5 minutes
        checkInterval = 300000;
    }
    
    // Schedule next check
    setTimeout(adaptiveMemoryCheck, checkInterval);
};

// Start adaptive memory checking
setTimeout(() => {
    // Log memory configuration
    const memoryLimitMB = parseInt(process.env.MEMORY_LIMIT_MB) || 0;
    const memoryWarnThreshold = parseFloat(process.env.MEMORY_WARN_THRESHOLD) || 0.8;
    const memoryCriticalThreshold = parseFloat(process.env.MEMORY_CRITICAL_THRESHOLD) || 0.9;
    const memoryCheckFrequency = parseInt(process.env.MEMORY_CHECK_FREQUENCY) || 0;
    
    logger.info(`Memory management initialized with: ${memoryLimitMB === 0 ? 'No limit' : `${memoryLimitMB}MB limit`}, ` +
                `warn at ${Math.round(memoryWarnThreshold * 100)}%, critical at ${Math.round(memoryCriticalThreshold * 100)}%, ` +
                `check frequency: ${memoryCheckFrequency === 0 ? 'adaptive' : `${memoryCheckFrequency}s`}`);
    
    adaptiveMemoryCheck();
}, 60000); // First check after 1 minute

// Run garbage collection on startup if available
if (global.gc) {
    global.gc();
    logger.info('Initial garbage collection performed');
}

// Enhanced shutdown handling
async function shutdownShard(signal) {
    // For SIGINT, exit immediately
    if (signal === 'SIGINT') {
        try {
            // Quick cleanup of lock file
            await removeShardLock();
        } catch (e) {
            // Ignore cleanup errors during force shutdown
        }
        process.exit(0);
        return;
    }

    logger.info(`Shard ${process.argv[2]} received ${signal}, cleaning up...`);
    try {
        // Clear intervals
        for (const interval of client.intervals || []) {
            clearInterval(interval);
        }
        
        // Clear all collections
        client.commands?.clear();
        client.cooldowns?.clear();
        client.settings?.clear();
        client.queues?.clear();
        
        // Destroy all voice connections
        for (const [guildId, queue] of (client.queues || new Map()).entries()) {
            if (queue?.connection) {
                try {
                    queue.connection.destroy();
                } catch (e) {
                    logger.warn(`Failed to destroy voice connection for guild ${guildId}: ${e.message}`);
                }
            }
        }
        
        // Save settings one last time
        if (typeof saveSettings === 'function') {
            await saveSettings().catch(e => logger.warn(`Failed to save settings during shutdown: ${e.message}`));
        }
        
        // Destroy the client
        if (client?.destroy) {
            await client.destroy();
        }
        
        // Remove lock file
        await removeShardLock();
        
        logger.info(`Shard ${process.argv[2]} cleanup complete`);
        
        // Force exit after a delay
        setTimeout(() => process.exit(0), 1000);
    } catch (error) {
        logger.error(`Error during shard ${process.argv[2]} cleanup:`, error);
        process.exit(1);
    }
}

// Handle process signals
process.on('SIGTERM', () => shutdownShard('SIGTERM'));
process.on('SIGINT', () => shutdownShard('SIGINT'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
    if (!handleNonFatalError(error, 'unhandled rejection')) {
        logger.error('Unhandled promise rejection:', error);
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
    if (!handleNonFatalError(error, 'uncaught exception')) {
        logger.error('Uncaught exception:', error);
        await shutdownShard('UNCAUGHT_EXCEPTION');
    }
});

// Saving settings flag to prevent concurrent writes
let isSavingSettings = false;
let settingsWriteQueue = [];
let lastSuccessfulSettings = null; // Store last known good settings

// Load settings if they exist
const settingsFile = process.env.ABSOLUTE_SETTINGS_PATH;
const loadSettings = async () => {
    if (!settingsFile) return;
    
    try {
        // Check if file exists first
        await fsPromises.access(settingsFile).catch(async () => {
            // Create empty settings file if it doesn't exist
            await fsPromises.writeFile(settingsFile, '{}', 'utf8');
            logger.info(`Created new settings file at ${settingsFile}`);
        });
        
        // Read settings file
        const data = await fsPromises.readFile(settingsFile, 'utf8');
        
        // Handle empty files
        if (!data.trim()) {
            // Check if we have a backup before creating an empty file
            if (lastSuccessfulSettings) {
                logger.warn(`Settings file ${settingsFile} is empty, restoring from memory backup`);
                await fsPromises.writeFile(settingsFile, JSON.stringify(lastSuccessfulSettings, null, 2), 'utf8');
                
                // Load settings into client
                client.settings = new Map();
                for (const [key, value] of Object.entries(lastSuccessfulSettings)) {
                    client.settings.set(key, value);
                }
                
                logger.info(`Restored ${client.settings.size} settings from memory backup`);
                return;
            }
            
            logger.warn(`Settings file ${settingsFile} is empty, creating new settings`);
            await fsPromises.writeFile(settingsFile, '{}', 'utf8');
            client.settings = new Map();
            return;
        }
        
        // Try to parse settings with error recovery
        let settingsData;
        try {
            // Normal parsing attempt
            settingsData = JSON.parse(data);
            
            // Store successful settings as backup
            lastSuccessfulSettings = settingsData;
        } catch (parseError) {
            logger.error(`Error parsing settings file: ${parseError.message}`);
            
            // Check if we have a backup before attempting recovery
            if (lastSuccessfulSettings) {
                logger.info(`Using memory backup instead of attempting recovery`);
                settingsData = lastSuccessfulSettings;
                
                // Write the backup to the file
                await fsPromises.writeFile(settingsFile, JSON.stringify(lastSuccessfulSettings, null, 2), 'utf8');
                logger.info(`Restored settings file from memory backup with ${Object.keys(lastSuccessfulSettings).length} entries`);
            } else {
                // Attempt to recover corrupted JSON
                try {
                    // Create a backup of corrupted file
                    const backupPath = `${settingsFile}.corrupt.${Date.now()}`;
                    await fsPromises.writeFile(backupPath, data, 'utf8');
                    logger.info(`Backed up corrupted settings to ${backupPath}`);
                    
                    // Try to recover by finding the last complete object
                    let recoveredData = '{}';
                    if (data.trim().startsWith('{')) {
                        // Look for the last balanced closing bracket
                        let openBrackets = 0;
                        let lastValidIndex = -1;
                        
                        for (let i = 0; i < data.length; i++) {
                            if (data[i] === '{') openBrackets++;
                            else if (data[i] === '}') openBrackets--;
                            
                            if (openBrackets === 0) lastValidIndex = i;
                        }
                        
                        if (lastValidIndex > 0) {
                            // Extract the valid part of the JSON
                            recoveredData = data.substring(0, lastValidIndex + 1);
                            try {
                                // Validate the extracted JSON
                                JSON.parse(recoveredData);
                                logger.info(`Successfully recovered settings data from corrupted file`);
                            } catch {
                                // If still invalid, fall back to empty object
                                recoveredData = '{}';
                                logger.warn(`Recovery attempt failed, using empty settings`);
                            }
                        }
                    }
                    
                    // Write the recovered or empty data back to the settings file
                    await fsPromises.writeFile(settingsFile, recoveredData, 'utf8');
                    settingsData = JSON.parse(recoveredData);
                    
                    // Store recovered settings as backup
                    lastSuccessfulSettings = settingsData;
                    
                    logger.info(`Settings file restored with ${Object.keys(settingsData).length} entries`);
                } catch (recoveryError) {
                    // If recovery fails, create a new settings file
                    logger.error(`Failed to recover settings: ${recoveryError.message}`);
                    await fsPromises.writeFile(settingsFile, '{}', 'utf8');
                    settingsData = {};
                    logger.warn(`Created new empty settings file`);
                }
            }
        }
        
        // Load settings into client
        client.settings.clear(); // Clear any existing settings
        for (const [key, value] of Object.entries(settingsData)) {
            client.settings.set(key, value);
        }
        
        logger.info(`Loaded ${client.settings.size} settings from ${settingsFile}`);
    } catch (error) {
        if (!handleNonFatalError(error, 'settings load')) {
            logger.warn(`Error loading settings from ${settingsFile}: ${error.message}`);
            
            // Check if we have a backup before creating an empty file
            if (lastSuccessfulSettings) {
                logger.info(`Using memory backup instead of creating empty settings`);
                
                try {
                    // Write the backup to the file
                    await fsPromises.writeFile(settingsFile, JSON.stringify(lastSuccessfulSettings, null, 2), 'utf8');
                    
                    // Load settings into client
                    client.settings = new Map();
                    for (const [key, value] of Object.entries(lastSuccessfulSettings)) {
                        client.settings.set(key, value);
                    }
                    
                    logger.info(`Restored ${client.settings.size} settings from memory backup`);
                    return;
                } catch (writeError) {
                    logger.error(`Failed to restore from memory backup: ${writeError.message}`);
                }
            }
            
            // Try to create a fresh settings file if there was an error
            try {
                await fsPromises.writeFile(settingsFile, '{}', 'utf8');
                logger.info(`Created new empty settings file due to error`);
            } catch (writeError) {
                logger.error(`Failed to create fresh settings file: ${writeError.message}`);
            }
        }
    }
};

// Save settings function with retry logic and atomic writes
const saveSettings = async () => {
    if (!settingsFile) return;
    
    // If already saving, add to queue
    if (isSavingSettings) {
        settingsWriteQueue.push(Date.now());
        return;
    }
    
    isSavingSettings = true;
    try {
        const settingsData = {};
        for (const [key, value] of client.settings.entries()) {
            settingsData[key] = value;
        }
        
        // Store current settings as backup before saving
        lastSuccessfulSettings = settingsData;
        
        // Create a temporary file for atomic write
        const tmpFile = `${settingsFile}.tmp`;
        
        // Create a backup file before saving
        const backupFile = `${settingsFile}.backup`;
        try {
            // Only create backup if the original file exists and has content
            if (await fsPromises.access(settingsFile).then(() => true).catch(() => false)) {
                const currentData = await fsPromises.readFile(settingsFile, 'utf8');
                if (currentData && currentData.trim() !== '{}') {
                    await fsPromises.writeFile(backupFile, currentData, 'utf8');
                    logger.info(`Created settings backup at ${backupFile}`);
                }
            }
        } catch (backupError) {
            logger.warn(`Failed to create settings backup: ${backupError.message}`);
        }
        
        // Write with retry logic
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
            try {
                // First write to temporary file
                await fsPromises.writeFile(
                    tmpFile,
                    JSON.stringify(settingsData, null, 2),
                    'utf8'
                );
                
                // Validate the written JSON by reading it back
                const writtenData = await fsPromises.readFile(tmpFile, 'utf8');
                
                // Try parsing to confirm it's valid JSON
                JSON.parse(writtenData);
                
                // If we get here, the JSON is valid - atomically replace the original file
                try {
                    // On Windows, we need to unlink the old file first
                    if (process.platform === "win32") {
                        try { await fsPromises.unlink(settingsFile); } catch {}
                    }
                    
                    // Rename temp file to actual settings file
                    await fsPromises.rename(tmpFile, settingsFile);
                } catch (renameError) {
                    logger.warn(`Could not rename temp file, trying copy instead: ${renameError.message}`);
                    
                    // Fallback copy method
                    await fsPromises.copyFile(tmpFile, settingsFile);
                    await fsPromises.unlink(tmpFile).catch(() => {});
                }
                
                logger.info(`Settings saved successfully (${Object.keys(settingsData).length} entries)`);
                break;
            } catch (error) {
                attempts++;
                if (attempts >= maxAttempts) {
                    throw error; // Re-throw after max attempts
                }
                // Wait before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempts)));
            }
        }
    } catch (error) {
        if (!handleNonFatalError(error, 'settings save')) {
            logger.error(`Error saving settings: ${error.message}`);
            
            // Try to restore from backup if save failed
            try {
                const backupFile = `${settingsFile}.backup`;
                if (await fsPromises.access(backupFile).then(() => true).catch(() => false)) {
                    const backupData = await fsPromises.readFile(backupFile, 'utf8');
                    if (backupData && backupData.trim() !== '{}') {
                        await fsPromises.writeFile(settingsFile, backupData, 'utf8');
                        logger.info(`Restored settings from backup file after failed save`);
                    }
                }
            } catch (restoreError) {
                logger.error(`Failed to restore settings from backup: ${restoreError.message}`);
            }
        }
    } finally {
        isSavingSettings = false;
        
        // Process next save if queue not empty (after a short delay)
        if (settingsWriteQueue.length > 0) {
            settingsWriteQueue = []; // Clear queue
            setTimeout(saveSettings, 100); // Process next write after a short delay
        }
    }
};

// Load commands
const loadCommands = async () => {
    const commandsPath = path.join(__dirname, 'commands');
    try {
        const commandFiles = await fsPromises.readdir(commandsPath);
        const jsFiles = commandFiles.filter(file => file.endsWith('.js'));
        
        for (const file of jsFiles) {
            try {
                const commandPath = path.join(commandsPath, file);
                delete require.cache[require.resolve(commandPath)]; // Clear cache in case of reload
                const command = require(commandPath);
                
                // Extract command name - handle different command formats
                let commandName = '';
                
                // Case 1: Command has a name property
                if (command.name) {
                    commandName = command.name;
                }
                // Case 2: SlashCommand with data property
                else if (command.data && command.data.name) {
                    commandName = command.data.name;
                }
                // Case 3: Use file name without extension as fallback
                else {
                    commandName = file.replace('.js', '');
                    logger.warn(`Using filename ${commandName} as command name for ${file}`);
                }
                
                // Add name property to command object for consistency
                command.name = commandName;
                
                // Register command
                client.commands.set(commandName, command);
                logger.info(`Loaded command: ${commandName}`);
            } catch (error) {
                if (!handleNonFatalError(error, 'command load')) {
                    logger.error(`Error loading command ${file}:`, error);
                }
            }
        }
        
        logger.info(`Loaded ${client.commands.size} commands successfully`);
    } catch (error) {
        if (!handleNonFatalError(error, 'commands directory')) {
            logger.error(`Error reading commands directory:`, error);
        }
    }
};

// Load event handlers
const loadEvents = async () => {
    const eventsPath = path.join(__dirname, 'events');
    try {
        const exists = await fsPromises.access(eventsPath).then(() => true).catch(() => false);
        if (!exists) {
            logger.warn(`Events directory not found at ${eventsPath}`);
            return;
        }
        
        const eventFiles = await fsPromises.readdir(eventsPath);
        const jsFiles = eventFiles.filter(file => file.endsWith('.js'));
        
        for (const file of jsFiles) {
            try {
                const eventPath = path.join(eventsPath, file);
                delete require.cache[require.resolve(eventPath)]; // Clear cache in case of reload
                const event = require(eventPath);
                
                if (event.once) {
                    client.once(event.name, (...args) => {
                        try {
                            event.execute(...args, client);
                        } catch (error) {
                            if (!handleNonFatalError(error, `event ${event.name}`)) {
                                logger.error(`Error in event ${event.name}:`, error);
                            }
                        }
                    });
                } else {
                    client.on(event.name, (...args) => {
                        try {
                            event.execute(...args, client);
                        } catch (error) {
                            if (!handleNonFatalError(error, `event ${event.name}`)) {
                                logger.error(`Error in event ${event.name}:`, error);
                            }
                        }
                    });
                }
                
                logger.info(`Loaded event: ${event.name}`);
            } catch (error) {
                if (!handleNonFatalError(error, 'event load')) {
                    logger.error(`Error loading event ${file}:`, error);
                }
            }
        }
    } catch (error) {
        if (!handleNonFatalError(error, 'events directory')) {
            logger.error(`Error reading events directory:`, error);
        }
    }
};

// Add this function after loadCommands
const registerCommands = async () => {
    try {
        const commands = [];
        const commandFiles = await fsPromises.readdir(path.join(__dirname, 'commands'));
        const jsFiles = commandFiles.filter(file => file.endsWith('.js'));
        
        for (const file of jsFiles) {
            const commandPath = path.join(__dirname, 'commands', file);
            const command = require(commandPath);
            
            if ('data' in command && 'execute' in command) {
                commands.push(command.data.toJSON());
                logger.info(`Prepared command for registration: ${command.data.name}`);
            }
        }

        const rest = new REST().setToken(process.env.TOKEN);
        logger.info(`Started refreshing ${commands.length} application (/) commands.`);

        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        logger.info(`Successfully registered ${data.length} application (/) commands.`);
    } catch (error) {
        logger.error('Error registering commands:', error);
    }
};

// Modify the startup sequence to include command registration
const startBot = async () => {
    try {
        // Check if another instance is running
        if (await isShardRunning()) {
            logger.error(`Shard ${process.argv[2]} is already running!`);
            process.exit(1);
        }

        // Create lock file
        await createShardLock();

        // Load settings first
        await loadSettings();
        logger.info('Settings loaded successfully');

        // Load commands and events
        await loadCommands();
        await loadEvents();
        
        // Register commands with Discord API
        await registerCommands();

        // Add saveSettings method to client
        client.saveSettings = saveSettings;

        // Login
        await client.login(process.env.TOKEN);
    } catch (error) {
        logger.error('Error starting bot:', error);
        await removeShardLock();
        process.exit(1);
    }
};

// Handle shard-specific events
client.on('shardReady', id => {
    logger.info(`Shard ${id} ready`);
});

client.on('shardDisconnect', (closeEvent, id) => {
    logger.warn(`Shard ${id} disconnected:`, closeEvent);
});

client.on('shardReconnecting', id => {
    logger.info(`Shard ${id} reconnecting`);
});

client.on('shardResume', (replayed, id) => {
    logger.info(`Shard ${id} resumed. Replayed ${replayed} events.`);
});

client.on('shardError', (error, id) => {
    if (!handleNonFatalError(error, `shard ${id}`)) {
        logger.error(`Shard ${id} error:`, error);
    }
});

// Add function to check if user is admin (used by music routes)
client.isAdmin = (userId) => {
    // Implement your admin check logic here
    // For example, check if user is in a specific role or has specific permissions
    return true; // Temporary placeholder, replace with actual logic
};

// Start the bot
startBot();

// Add periodic settings backup
const createPeriodicBackup = async () => {
    if (!settingsFile) return;
    
    try {
        // Only create backup if settings exist and have content
        if (client.settings && client.settings.size > 0) {
            const backupDir = path.join(__dirname, 'settings_backups');
            
            // Create backup directory if it doesn't exist
            await fsPromises.mkdir(backupDir, { recursive: true });
            
            // Create timestamped backup file
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = path.join(backupDir, `settings_${timestamp}.json`);
            
            // Get settings data
            const settingsData = {};
            for (const [key, value] of client.settings.entries()) {
                settingsData[key] = value;
            }
            
            // Write backup file
            await fsPromises.writeFile(backupFile, JSON.stringify(settingsData, null, 2), 'utf8');
            logger.info(`Created periodic settings backup at ${backupFile}`);
            
            // Clean up old backups (keep last 24)
            const backupFiles = await fsPromises.readdir(backupDir);
            if (backupFiles.length > 24) {
                // Sort files by creation time (oldest first)
                const sortedFiles = backupFiles
                    .filter(file => file.startsWith('settings_'))
                    .map(file => ({
                        name: file,
                        path: path.join(backupDir, file),
                        time: fs.statSync(path.join(backupDir, file)).mtime.getTime()
                    }))
                    .sort((a, b) => a.time - b.time);
                
                // Delete oldest files
                const filesToDelete = sortedFiles.slice(0, sortedFiles.length - 24);
                for (const file of filesToDelete) {
                    await fsPromises.unlink(file.path);
                    logger.info(`Deleted old settings backup: ${file.name}`);
                }
            }
        }
    } catch (error) {
        logger.error(`Error creating periodic settings backup: ${error.message}`);
    }
};

// Run backup every hour
setInterval(createPeriodicBackup, 60 * 60 * 1000);

// Also run backup on process exit
process.on('exit', () => {
    // Use sync methods since we're exiting
    try {
        if (client.settings && client.settings.size > 0 && settingsFile) {
            const backupDir = path.join(__dirname, 'settings_backups');
            
            // Create backup directory if it doesn't exist
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            
            // Create exit backup file
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = path.join(backupDir, `settings_exit_${timestamp}.json`);
            
            // Get settings data
            const settingsData = {};
            for (const [key, value] of client.settings.entries()) {
                settingsData[key] = value;
            }
            
            // Write backup file
            fs.writeFileSync(backupFile, JSON.stringify(settingsData, null, 2), 'utf8');
            console.log(`Created exit settings backup at ${backupFile}`);
        }
    } catch (error) {
        console.error(`Error creating exit settings backup: ${error.message}`);
    }
}); 