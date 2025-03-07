const logger = require('../utils/logger');
const chalk = require('chalk');
const { checkReminders } = require('../commands/bumpreminder');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    await checkReminders(client); // Call checkReminders with await

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