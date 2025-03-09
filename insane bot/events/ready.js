const logger = require('../utils/logger');
const chalk = require('chalk');
const { checkReminders } = require('../commands/bumpreminder');

// Utility functions for JTC channel management
const getCreatedChannels = (client, guildId) => {
  const key = `${guildId}:jtc_channels`;
  const data = client.settings.get(key) || {};
  return new Map(Object.entries(data));
};

const saveCreatedChannels = (client, guildId, channels) => {
  const key = `${guildId}:jtc_channels`;
  const data = Object.fromEntries(channels);
  client.settings.set(key, data);
  // Force save to file
  if (client.saveSettings && typeof client.saveSettings === 'function') {
    client.saveSettings();
  }
};

// Cleanup function for JTC channels
const cleanupEmptyChannels = async (client, guild) => {
  const guildId = guild.id;
  const createdChannels = getCreatedChannels(client, guildId);
  let hasChanges = false;
  
  if (createdChannels.size === 0) return false;
  
  logger.info(`[CLEANUP] Found ${createdChannels.size} tracked channels in guild ${guildId}`);
  
  // Create a copy of the keys since we'll be modifying the Map
  const channelIds = Array.from(createdChannels.keys());
  
  for (const channelId of channelIds) {
    try {
      const channelData = createdChannels.get(channelId);
      
      // Try to fetch both voice and text channels
      const voiceChannel = await guild.channels.fetch(channelData.vcId).catch(() => null);
      const textChannel = channelData.textChannelId ? await guild.channels.fetch(channelData.textChannelId).catch(() => null) : null;
      
      // Delete if channel doesn't exist or is empty
      if (!voiceChannel || voiceChannel.members.size === 0) {
        // Delete text channel if it exists
        if (textChannel) {
          await textChannel.delete().catch(err => logger.error(`[CLEANUP] Failed to delete text channel: ${err.message}`));
        }
        
        // Delete voice channel if it exists
        if (voiceChannel) {
          await voiceChannel.delete().catch(err => logger.error(`[CLEANUP] Failed to delete voice channel: ${err.message}`));
        }
        
        // Remove from tracking
        createdChannels.delete(channelId);
        hasChanges = true;
      }
    } catch (error) {
      logger.error(`[CLEANUP] Error processing channel ${channelId}: ${error.message}`);
      createdChannels.delete(channelId);
      hasChanges = true;
    }
  }
  
  // Save only if changes were made
  if (hasChanges) {
    try {
      saveCreatedChannels(client, guildId, createdChannels);
      logger.info(`[CLEANUP] Removed ${channelIds.length - createdChannels.size} channels from guild ${guildId}`);
    } catch (error) {
      logger.error(`[CLEANUP] Error saving changes: ${error.message}`);
    }
  }
  
  return hasChanges;
};

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    await checkReminders(client);

    // Run cleanup on all guilds when bot starts
    logger.info('Starting JTC channel cleanup...');
    let totalCleaned = 0;
    
    for (const guild of client.guilds.cache.values()) {
      try {
        const settingsFile = process.env.ABSOLUTE_SETTINGS_PATH;
        const data = await require('fs').promises.readFile(settingsFile, 'utf8');
        const settings = JSON.parse(data);
        
        const jtcChannels = settings[`${guild.id}:jtc_channels`];
        if (jtcChannels) {
          const cleaned = await cleanupEmptyChannels(client, guild);
          if (cleaned) totalCleaned++;
        }
      } catch (error) {
        logger.error(`Error during cleanup for guild ${guild.id}: ${error.message}`);
      }
    }
    logger.info(`Completed JTC channel cleanup. Cleaned channels in ${totalCleaned} guilds.`);

    // Status messages to cycle through during startup
    const statusMessages = [
      'Starting Bot',
      'Loading Commands',
      'Syncing Settings',
      'Ready to Serve'
    ];
    const dotStates = ['', '.', '..', '...']; // Dot animation stages
    let currentMessageIndex = 0;
    let dotIndex = 0;
    let isWaiting = false;
    let isStartupComplete = false;

    // Get custom status messages from .env, with defaults if not set
    const statusMessage1 = process.env.STATUS_MESSAGE_1 || 'Serving MizMix!';
    const statusMessage2 = process.env.STATUS_MESSAGE_2 || 'Use /play';

    // Function to update status with logging
    const setStatus = (name, type = 0, status = 'online') => {
      try {
        client.user.setPresence({
          activities: [{ name, type }],
          status
        });
        logger.info(chalk.blue(`Set status to "Playing ${name}" on shard ${client.shard.ids[0]}`));
        return true;
      } catch (error) {
        logger.error(chalk.red(`Error setting presence for "${name}": ${error.message}`));
        return false; // Continue even on error
      }
    };

    // Function to handle the alternating final status
    const startAlternatingStatus = () => {
      let isFirstMessage = true;
      const alternateStatus = () => {
        const statusText = isFirstMessage ? statusMessage1 : statusMessage2;
        setStatus(statusText);
        isFirstMessage = !isFirstMessage;
        setTimeout(alternateStatus, 60000); // Switch every 60 seconds
      };
      alternateStatus();
    };

    // Recursive function to handle startup status updates
    const updateStatus = () => {
      if (isWaiting) {
        // After the pause, move to the next message
        isWaiting = false;
        dotIndex = 0;
        currentMessageIndex++;
        if (currentMessageIndex >= statusMessages.length) {
          isStartupComplete = true;
          startAlternatingStatus();
          return; // Exit startup sequence
        }
      }

      const baseMessage = statusMessages[currentMessageIndex];
      const displayMessage = `${baseMessage}${dotStates[dotIndex]}`;
      setStatus(displayMessage);

      dotIndex++;
      if (dotIndex >= dotStates.length) {
        dotIndex--; // Stay on "..." during the pause
        isWaiting = true;
      }

      // Schedule the next update with appropriate delay
      const nextDelay = isWaiting ? 15000 : 1000; // 1s for dots, 15s for pause
      setTimeout(updateStatus, nextDelay);
    };

    // Start the sequence
    updateStatus();
  },
};