require('dotenv').config();
const { ShardingManager } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const logger = require('./utils/logger');

// Add process lock file check
const LOCK_FILE = path.join(__dirname, '.bot.lock');

// Function to check if bot is already running
async function isAlreadyRunning() {
    try {
        // Check if lock file exists
        await fs.access(LOCK_FILE);
        
        // Read PID from lock file
        const pid = parseInt(await fs.readFile(LOCK_FILE, 'utf8'));
        
        // Check if process with that PID is running
        try {
            process.kill(pid, 0);
            return true; // Process is running
        } catch (e) {
            // Process not running, clean up stale lock file
            await fs.unlink(LOCK_FILE).catch(() => {});
            return false;
        }
    } catch (e) {
        return false; // Lock file doesn't exist
    }
}

// Function to create lock file
async function createLockFile() {
    await fs.writeFile(LOCK_FILE, process.pid.toString());
}

// Function to remove lock file
async function removeLockFile() {
    await fs.unlink(LOCK_FILE).catch(() => {});
}

// Capture console errors first thing to prevent crashes
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

// Wrap stdout and stderr to prevent crash on write error
process.stdout.write = function(chunk, encoding, callback) {
  try {
    return originalStdoutWrite(chunk, encoding, callback);
  } catch (error) {
    // Swallow the error to prevent crash
    if (callback) {
      callback(error);
    }
    return false;
  }
};

process.stderr.write = function(chunk, encoding, callback) {
  try {
    return originalStderrWrite(chunk, encoding, callback);
  } catch (error) {
    // Swallow the error to prevent crash
    if (callback) {
      callback(error);
    }
    return false;
  }
};

// Start the dashboard (index.js) and pass the ShardingManager instance
const dashboard = require('./view/index');

// Global variable to track ShardingManager instance
let globalManager = null;

// Validate environment variables
if (!process.env.TOKEN) {
    logger.errorSync('No TOKEN found in .env file. Please set it and try again.');
    process.exit(1);
}

if (!process.env.CLIENT_ID || !/^\d+$/.test(process.env.CLIENT_ID)) {
    logger.errorSync('CLIENT_ID is missing or invalid in .env. Please set a valid Discord snowflake.');
    process.exit(1);
}

if (!process.env.WEB_PORT) {
    logger.warn('WEB_PORT not set in .env. Defaulting to 3000.');
    process.env.WEB_PORT = '3000';
}

if (!process.env.ABSOLUTE_SETTINGS_PATH) {
    logger.errorSync('ABSOLUTE_SETTINGS_PATH not set in .env. Please set the path to settings.json.');
    process.exit(1);
}

// Setup global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    logger.errorSync('Uncaught exception:', error.message);
    logger.errorSync(error.stack);
    
    // Don't exit process on non-fatal errors
    if (error.code === 'ECONNREFUSED' || error.code === 'EPIPE' || 
        error.code === 'EIO' || error.code === 'ECONNRESET' || 
        error.code === 'ERR_STREAM_WRITE_AFTER_END' || error.code === 'ERR_STREAM_DESTROYED') {
        logger.warn('Non-fatal I/O error, continuing execution');
        return;
    }
    
    // Exit for fatal errors
    logger.errorSync('Fatal error occurred, shutting down...');
    setTimeout(() => process.exit(1), 1000); // Give logger time to write
});

process.on('unhandledRejection', (reason, promise) => {
    logger.errorSync('Unhandled promise rejection:', reason);
    // Continue execution
});

// Flag to track if we're already shutting down
let isShuttingDown = false;

// Graceful shutdown
const shutdown = async (signal) => {
    // Prevent multiple shutdown attempts
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;
    
    logger.info(`Received ${signal} signal, shutting down gracefully...`);
    
    try {
        // For SIGINT (Ctrl+C), kill everything immediately
        if (signal === 'SIGINT') {
            logger.info('Received Ctrl+C, forcing immediate shutdown...');
            
            // Kill all shards immediately
            if (globalManager) {
                for (const [id, shard] of globalManager.shards) {
                    try {
                        if (shard.process) {
                            process.kill(shard.process.pid, 'SIGKILL');
                        }
                    } catch (e) {
                        // Ignore errors when killing processes
                    }
                }
            }
            
            // Clean up lock files
            await removeLockFile();
            try {
                const files = await fs.promises.readdir(__dirname);
                for (const file of files) {
                    if (file.startsWith('.shard-') && file.endsWith('.lock')) {
                        await fs.promises.unlink(path.join(__dirname, file)).catch(() => {});
                    }
                }
            } catch (e) {
                // Ignore cleanup errors during force shutdown
            }
            
            // Exit immediately
            process.exit(0);
            return;
        }
        
        // Normal graceful shutdown for other signals
        // Remove lock file first
        await removeLockFile();
        
        // Tell all shards to shutdown cleanly
        if (globalManager) {
            logger.info('Shutting down all shards...');
            
            // Send shutdown signal to all shards
            for (const [id, shard] of globalManager.shards) {
                try {
                    await shard.eval('process.emit("SIGTERM")');
                    logger.info(`Sent shutdown signal to shard ${id}`);
                } catch (e) {
                    logger.warn(`Failed to send shutdown signal to shard ${id}: ${e.message}`);
                }
            }
            
            // Wait for shards to cleanup (max 5 seconds)
            await Promise.race([
                new Promise(resolve => setTimeout(resolve, 5000)),
                Promise.all(Array.from(globalManager.shards.values()).map(shard => 
                    new Promise(resolve => {
                        const checkInterval = setInterval(() => {
                            if (!shard.process || shard.process.killed) {
                                clearInterval(checkInterval);
                                resolve();
                            }
                        }, 100);
                    })
                ))
            ]);
            
            // Force kill any remaining shards
            for (const [id, shard] of globalManager.shards) {
                if (shard.process && !shard.process.killed) {
                    try {
                        shard.process.kill('SIGKILL');
                        logger.warn(`Force killed shard ${id}`);
                    } catch (e) {
                        // Ignore errors when killing already dead processes
                    }
                }
            }
            
            // Clean up any remaining lock files
            try {
                const files = await fs.promises.readdir(__dirname);
                for (const file of files) {
                    if (file.startsWith('.shard-') && file.endsWith('.lock')) {
                        await fs.promises.unlink(path.join(__dirname, file)).catch(() => {});
                    }
                }
            } catch (e) {
                logger.warn(`Failed to clean up some shard lock files: ${e.message}`);
            }
        }
        
        // Give a chance for final logs to be written
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        logger.info('Shutdown complete');
        
        // Force exit after a short delay no matter what
        setTimeout(() => {
            process.exit(0);
        }, 2000);
    } catch (error) {
        logger.errorSync('Error during shutdown:', error);
        // Force exit after error
        process.exit(1);
    }
};

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function startBot() {
    try {
        // Check if bot is already running
        if (await isAlreadyRunning()) {
            logger.errorSync('Bot is already running! If this is incorrect, delete the .bot.lock file.');
            process.exit(1);
        }

        // Create lock file
        await createLockFile();
        
        // Create the ShardingManager with specific settings
        const manager = new ShardingManager('./shard.js', {
            token: process.env.TOKEN,
            totalShards: process.env.SHARD_COUNT ? parseInt(process.env.SHARD_COUNT) : 'auto',
            respawn: true,
            mode: 'process',
            execArgv: ['--max-old-space-size=2048'], // Limit memory usage
            timeout: 30000, // Increase spawn timeout
        });
        
        // Store manager in global for shutdown access
        globalManager = manager;

        // Handle shard events
        manager.on('shardCreate', shard => {
            logger.info(chalk.green(`Launched shard ${shard.id}`));

            shard.on('ready', () => {
                logger.info(chalk.green(`Shard ${shard.id} ready`));
            });

            shard.on('disconnect', () => {
                logger.warn(chalk.yellow(`Shard ${shard.id} disconnected`));
            });

            shard.on('reconnecting', () => {
                logger.info(chalk.blue(`Shard ${shard.id} reconnecting`));
            });

            shard.on('death', (process) => {
                const exitCode = process.exitCode || 0;
                logger.error(chalk.red(`Shard ${shard.id} died with exit code ${exitCode}`));
                
                if (process.signalCode === 'SIGINT') {
                    logger.error('Shard died with SIGINT, this may indicate memory issues');
                }
            });
            
            shard.on('error', (error) => {
                logger.error(chalk.red(`Shard ${shard.id} error:`, error));
            });
        });

        // Start the shards
        await manager.spawn();
        logger.info(chalk.green('All shards spawned successfully'));

        // Start the dashboard with the manager instance
        try {
            dashboard.start(manager);
            logger.info(chalk.green('Dashboard started successfully'));
        } catch (dashboardError) {
            logger.error(chalk.red('Failed to start dashboard:', dashboardError));
            // Continue running the bot even if dashboard fails
        }

    } catch (error) {
        // Clean up lock file if startup fails
        await removeLockFile();
        logger.error(chalk.red('Failed to start bot:', error));
        process.exit(1);
    }
}

// Try to catch any early errors
process.once('beforeExit', async () => {
    logger.errorSync('Process exiting unexpectedly');
    await removeLockFile();
});

startBot().catch(async error => {
    await removeLockFile();
    logger.errorSync('Fatal error during startup:', error);
    process.exit(1);
});
