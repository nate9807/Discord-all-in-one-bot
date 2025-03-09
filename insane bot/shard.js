require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
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
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
    ],
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
    const used = process.memoryUsage();
    const heapUsed = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotal = Math.round(used.heapTotal / 1024 / 1024);
    
    // Log memory usage if it's getting high
    if (heapUsed > heapTotal * 0.8) {
        logger.warn(`High memory usage - Heap: ${heapUsed}MB / ${heapTotal}MB`);
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            logger.info('Forced garbage collection');
        }
    }
};

// Check memory usage periodically
setInterval(checkMemoryUsage, 300000); // Every 5 minutes

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
        } catch (parseError) {
            logger.error(`Error parsing settings file: ${parseError.message}`);
            
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
                logger.info(`Settings file restored with ${Object.keys(settingsData).length} entries`);
            } catch (recoveryError) {
                // If recovery fails, create a new settings file
                logger.error(`Failed to recover settings: ${recoveryError.message}`);
                await fsPromises.writeFile(settingsFile, '{}', 'utf8');
                settingsData = {};
                logger.warn(`Created new empty settings file`);
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
        
        // Create a temporary file for atomic write
        const tmpFile = `${settingsFile}.tmp`;
        
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

// Initialize bot and handle errors
async function initializeBot() {
    try {
        // Check if shard is already running
        if (await isShardRunning()) {
            logger.error(`Shard ${process.argv[2]} is already running! Exiting.`);
            process.exit(1);
        }

        // Create lock file
        await createShardLock();

        // Rest of initialization
        await repairSettingsFile();
        await loadSettings();
        await loadCommands();
        await loadEvents();
        
        // Store intervals for cleanup
        client.intervals = [];
        
        // Add memory check interval
        const memCheckInterval = setInterval(checkMemoryUsage, 300000);
        client.intervals.push(memCheckInterval);
        
        // Add settings save interval
        const settingsSaveInterval = setInterval(saveSettings, 300000);
        client.intervals.push(settingsSaveInterval);
        
        // Login to Discord
        await client.login(process.env.TOKEN);
        
        logger.info(`Shard ${process.argv[2]} initialized successfully`);
    } catch (error) {
        logger.error('Failed to initialize shard:', error);
        await shutdownShard('INIT_FAILURE');
    }
}

// Check and repair corrupted settings file if needed
async function repairSettingsFile() {
    if (!settingsFile) return;
    
    try {
        // Check if file exists
        const exists = await fsPromises.access(settingsFile)
            .then(() => true)
            .catch(() => false);
            
        if (!exists) {
            logger.info(`Settings file not found, will create a new one during initialization`);
            return;
        }
        
        // Read the file content
        const data = await fsPromises.readFile(settingsFile, 'utf8');
        
        // Skip empty files - they'll be handled by loadSettings
        if (!data.trim()) return;
        
        // Check if it's valid JSON
        try {
            JSON.parse(data);
            logger.info(`Verified settings file integrity at startup`);
            return; // File is valid
        } catch (parseError) {
            logger.warn(`Found corrupted settings file at startup: ${parseError.message}`);
            
            // Back up corrupted file
            const backupPath = `${settingsFile}.corrupt.startup.${Date.now()}`;
            await fsPromises.writeFile(backupPath, data, 'utf8');
            logger.info(`Backed up corrupted settings to ${backupPath}`);
            
            // Try to recover by finding the last complete object
            let recoveredData = '{}';
            if (data.trim().startsWith('{')) {
                let openBrackets = 0;
                let lastValidIndex = -1;
                
                // Find the last properly closed bracket
                for (let i = 0; i < data.length; i++) {
                    if (data[i] === '{') openBrackets++;
                    else if (data[i] === '}') openBrackets--;
                    
                    if (openBrackets === 0) lastValidIndex = i;
                }
                
                if (lastValidIndex > 0) {
                    recoveredData = data.substring(0, lastValidIndex + 1);
                    try {
                        // Verify recovered data
                        JSON.parse(recoveredData);
                        logger.info(`Successfully recovered settings data during startup repair`);
                    } catch {
                        recoveredData = '{}';
                        logger.warn(`Could not recover settings data, using empty object`);
                    }
                }
            }
            
            // Save the recovered or empty data
            await fsPromises.writeFile(settingsFile, recoveredData, 'utf8');
            logger.info(`Repaired settings file at startup`);
        }
    } catch (error) {
        logger.error(`Error repairing settings file: ${error.message}`);
        // Continue anyway - loadSettings will handle this
    }
}

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
initializeBot(); 