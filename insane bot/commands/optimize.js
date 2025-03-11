const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('optimize')
    .setDescription('Optimize bot memory usage and configure memory settings (Owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('run')
        .setDescription('Run memory optimization')
        .addBooleanOption(option =>
          option
            .setName('aggressive')
            .setDescription('Use aggressive optimization (clears more data)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Show current memory status and settings')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('config')
        .setDescription('Configure memory settings')
        .addIntegerOption(option =>
          option
            .setName('limit')
            .setDescription('Memory limit in MB (0 = no limit)')
            .setRequired(false)
            .setMinValue(0)
        )
        .addNumberOption(option =>
          option
            .setName('warn')
            .setDescription('Warning threshold (0.0-1.0, e.g. 0.8 = 80%)')
            .setRequired(false)
            .setMinValue(0.1)
            .setMaxValue(0.99)
        )
        .addNumberOption(option =>
          option
            .setName('critical')
            .setDescription('Critical threshold (0.0-1.0, e.g. 0.9 = 90%)')
            .setRequired(false)
            .setMinValue(0.1)
            .setMaxValue(0.99)
        )
        .addIntegerOption(option =>
          option
            .setName('frequency')
            .setDescription('Check frequency in seconds (0 = adaptive)')
            .setRequired(false)
            .setMinValue(0)
        )
    ),
  cooldown: 10, // 10 second cooldown
  async execute(interaction, client) {
    // Check if user is the bot owner
    if (interaction.user.id !== process.env.OWNERID) {
      return interaction.reply({
        content: 'This command can only be used by the bot owner.',
        ephemeral: true
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'run') {
      await interaction.deferReply({ ephemeral: true });
      const aggressive = interaction.options.getBoolean('aggressive') || false;

      try {
        // Get initial memory usage
        const initialUsage = process.memoryUsage();
        const initialHeapUsed = Math.round(initialUsage.heapUsed / 1024 / 1024);
        const initialHeapTotal = Math.round(initialUsage.heapTotal / 1024 / 1024);
        const initialRSS = Math.round(initialUsage.rss / 1024 / 1024);
        
        // Perform memory optimizations
        
        // 1. Clear command cooldowns
        let cooldownsCleared = 0;
        const now = Date.now();
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
        
        // 2. Trim music queue history
        let queueHistoryTrimmed = 0;
        for (const [guildId, queue] of client.queues.entries()) {
          if (queue && queue.history) {
            const initialLength = queue.history.length;
            // In aggressive mode, keep fewer items
            const keepItems = aggressive ? 10 : 20;
            if (initialLength > keepItems) {
              queue.history = queue.history.slice(-keepItems);
              queueHistoryTrimmed += (initialLength - queue.history.length);
            }
          }
        }
        
        // 3. Clear voice manager cache
        let voiceCacheCleared = 0;
        if (client.voiceManager && client.voiceManager.cache) {
          if (aggressive) {
            // Clear all cache in aggressive mode
            voiceCacheCleared = Object.keys(client.voiceManager.cache).length;
            client.voiceManager.cache = {};
          } else {
            // Clear old cache in normal mode
            const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
            for (const [key, data] of Object.entries(client.voiceManager.cache)) {
              if (data.timestamp && data.timestamp < thirtyMinutesAgo) {
                delete client.voiceManager.cache[key];
                voiceCacheCleared++;
              }
            }
          }
        }
        
        // 4. Clear any unused connections
        let connectionsCleared = 0;
        if (client.voice && client.voice.connections) {
          const connections = Array.from(client.voice.connections.values());
          for (const connection of connections) {
            // In aggressive mode, disconnect from all channels with <= 2 users
            // In normal mode, only disconnect from channels with just the bot
            const channel = connection.channel;
            if (channel && ((aggressive && channel.members.size <= 2) || channel.members.size <= 1)) {
              connection.disconnect();
              connectionsCleared++;
            }
          }
        }
        
        // 5. Force garbage collection if available
        if (global.gc) {
          global.gc();
          logger.info('Forced garbage collection during optimization');
        }
        
        // Get final memory usage
        const finalUsage = process.memoryUsage();
        const finalHeapUsed = Math.round(finalUsage.heapUsed / 1024 / 1024);
        const finalHeapTotal = Math.round(finalUsage.heapTotal / 1024 / 1024);
        const finalRSS = Math.round(finalUsage.rss / 1024 / 1024);
        
        // Calculate savings
        const heapSaved = initialHeapUsed - finalHeapUsed;
        const rssSaved = initialRSS - finalRSS;
        
        // Log optimization results
        logger.info(`Memory optimization complete. Heap: ${initialHeapUsed}MB → ${finalHeapUsed}MB (${heapSaved > 0 ? '-' : '+'}${Math.abs(heapSaved)}MB)`);
        
        // Send response
        return interaction.editReply({
          content: `# 🧹 Memory Optimization Complete (${aggressive ? 'Aggressive' : 'Standard'} Mode)\n\n` +
                  `## Memory Usage\n` +
                  `**Before:** ${initialHeapUsed}MB heap, ${initialRSS}MB total\n` +
                  `**After:** ${finalHeapUsed}MB heap, ${finalRSS}MB total\n` +
                  `**Saved:** ${heapSaved > 0 ? heapSaved : 0}MB heap, ${rssSaved > 0 ? rssSaved : 0}MB total\n\n` +
                  `## Cleanup Actions\n` +
                  `• Cleared ${cooldownsCleared} expired cooldowns\n` +
                  `• Trimmed ${queueHistoryTrimmed} items from music history\n` +
                  `• Cleared ${voiceCacheCleared} voice cache entries\n` +
                  `• Disconnected from ${connectionsCleared} voice channels\n` +
                  `• Ran garbage collection\n\n` +
                  `Memory optimization ${heapSaved > 0 ? 'successful' : 'completed, but usage did not decrease significantly'}. The bot should now run more efficiently.`,
          ephemeral: true
        });
      } catch (error) {
        logger.error(`Error optimizing memory: ${error.message}`);
        return interaction.editReply({
          content: `❌ Failed to optimize memory: ${error.message}`,
          ephemeral: true
        });
      }
    } else if (subcommand === 'status') {
      await interaction.deferReply({ ephemeral: true });
      
      try {
        // Get current memory usage
        const used = process.memoryUsage();
        const heapUsed = Math.round(used.heapUsed / 1024 / 1024);
        const heapTotal = Math.round(used.heapTotal / 1024 / 1024);
        const rss = Math.round(used.rss / 1024 / 1024);
        const external = Math.round(used.external / 1024 / 1024);
        const arrayBuffers = Math.round(used.arrayBuffers / 1024 / 1024);
        
        // Get current memory settings
        const memoryLimitMB = parseInt(process.env.MEMORY_LIMIT_MB) || 0;
        const memoryWarnThreshold = parseFloat(process.env.MEMORY_WARN_THRESHOLD) || 0.8;
        const memoryCriticalThreshold = parseFloat(process.env.MEMORY_CRITICAL_THRESHOLD) || 0.9;
        const memoryCheckFrequency = parseInt(process.env.MEMORY_CHECK_FREQUENCY) || 0;
        
        // Calculate usage percentages
        const heapPercentage = Math.round((heapUsed / heapTotal) * 100);
        const limitPercentage = memoryLimitMB > 0 ? Math.round((rss / memoryLimitMB) * 100) : null;
        
        // Format status message
        let statusMessage = `# 📊 Memory Status\n\n`;
        
        // Current usage
        statusMessage += `## Current Usage\n`;
        statusMessage += `• **Heap Memory:** ${heapUsed}MB / ${heapTotal}MB (${heapPercentage}%)\n`;
        statusMessage += `• **Total Memory (RSS):** ${rss}MB\n`;
        statusMessage += `• **External Memory:** ${external}MB\n`;
        statusMessage += `• **Array Buffers:** ${arrayBuffers}MB\n\n`;
        
        // Current settings
        statusMessage += `## Memory Settings\n`;
        statusMessage += `• **Memory Limit:** ${memoryLimitMB === 0 ? 'No limit' : `${memoryLimitMB}MB`}`;
        if (limitPercentage !== null) {
          statusMessage += ` (Currently at ${limitPercentage}%)`;
        }
        statusMessage += `\n`;
        statusMessage += `• **Warning Threshold:** ${Math.round(memoryWarnThreshold * 100)}%\n`;
        statusMessage += `• **Critical Threshold:** ${Math.round(memoryCriticalThreshold * 100)}%\n`;
        statusMessage += `• **Check Frequency:** ${memoryCheckFrequency === 0 ? 'Adaptive' : `${memoryCheckFrequency} seconds`}\n\n`;
        
        // Status assessment
        statusMessage += `## Status Assessment\n`;
        if (memoryLimitMB === 0) {
          statusMessage += `✅ **Unlimited memory mode enabled.** The bot will use as much memory as needed without warnings.\n`;
          statusMessage += `Current heap usage: ${heapPercentage}% (${heapUsed}MB / ${heapTotal}MB)\n`;
        } else {
          if (limitPercentage > Math.round(memoryCriticalThreshold * 100)) {
            statusMessage += `⚠️ **Critical memory usage detected.** The bot is using ${limitPercentage}% of your configured limit.\n`;
          } else if (limitPercentage > Math.round(memoryWarnThreshold * 100)) {
            statusMessage += `ℹ️ **High memory usage.** The bot is using ${limitPercentage}% of your configured limit.\n`;
          } else {
            statusMessage += `✅ **Memory usage is within limits.** The bot is using ${limitPercentage}% of your configured limit.\n`;
          }
        }
        
        // Recommendations
        statusMessage += `\n## Recommendations\n`;
        if (memoryLimitMB === 0) {
          statusMessage += `• You have unlimited memory mode enabled. The bot will use as much memory as needed.\n`;
          if (heapPercentage > 95) {
            statusMessage += `• Note: Your heap usage is very high (${heapPercentage}%). This is not a problem, but Node.js may allocate more memory soon.\n`;
          }
        } else if (limitPercentage > 90) {
          statusMessage += `• Consider increasing your memory limit or running \`/optimize run aggressive:true\`\n`;
        } else if (limitPercentage < 50) {
          statusMessage += `• Your memory limit may be higher than needed. Consider reducing it to save resources.\n`;
        }
        
        return interaction.editReply({
          content: statusMessage,
          ephemeral: true
        });
      } catch (error) {
        logger.error(`Error getting memory status: ${error.message}`);
        return interaction.editReply({
          content: `❌ Failed to get memory status: ${error.message}`,
          ephemeral: true
        });
      }
    } else if (subcommand === 'config') {
      await interaction.deferReply({ ephemeral: true });
      
      try {
        // Get current settings
        const currentLimit = parseInt(process.env.MEMORY_LIMIT_MB) || 0;
        const currentWarn = parseFloat(process.env.MEMORY_WARN_THRESHOLD) || 0.8;
        const currentCritical = parseFloat(process.env.MEMORY_CRITICAL_THRESHOLD) || 0.9;
        const currentFrequency = parseInt(process.env.MEMORY_CHECK_FREQUENCY) || 0;
        
        // Get new settings from options
        const newLimit = interaction.options.getInteger('limit');
        const newWarn = interaction.options.getNumber('warn');
        const newCritical = interaction.options.getNumber('critical');
        const newFrequency = interaction.options.getInteger('frequency');
        
        // Check if any settings were provided
        if (newLimit === null && newWarn === null && newCritical === null && newFrequency === null) {
          return interaction.editReply({
            content: `Please provide at least one setting to change. Current settings:\n\n` +
                    `• Memory Limit: ${currentLimit === 0 ? 'No limit' : `${currentLimit}MB`}\n` +
                    `• Warning Threshold: ${Math.round(currentWarn * 100)}%\n` +
                    `• Critical Threshold: ${Math.round(currentCritical * 100)}%\n` +
                    `• Check Frequency: ${currentFrequency === 0 ? 'Adaptive' : `${currentFrequency} seconds`}`,
            ephemeral: true
          });
        }
        
        // Validate thresholds
        if (newWarn !== null && newCritical !== null && newWarn >= newCritical) {
          return interaction.editReply({
            content: `❌ Warning threshold (${newWarn}) must be lower than critical threshold (${newCritical}).`,
            ephemeral: true
          });
        } else if (newWarn !== null && newCritical === null && newWarn >= currentCritical) {
          return interaction.editReply({
            content: `❌ Warning threshold (${newWarn}) must be lower than current critical threshold (${currentCritical}).`,
            ephemeral: true
          });
        } else if (newWarn === null && newCritical !== null && currentWarn >= newCritical) {
          return interaction.editReply({
            content: `❌ Current warning threshold (${currentWarn}) must be lower than new critical threshold (${newCritical}).`,
            ephemeral: true
          });
        }
        
        // Read .env file
        const envPath = path.resolve(process.cwd(), '.env');
        let envContent;
        try {
          envContent = await fs.readFile(envPath, 'utf8');
        } catch (error) {
          return interaction.editReply({
            content: `❌ Could not read .env file: ${error.message}`,
            ephemeral: true
          });
        }
        
        // Update .env content
        let updatedContent = envContent;
        const changes = [];
        
        // Update memory limit
        if (newLimit !== null) {
          if (updatedContent.includes('MEMORY_LIMIT_MB=')) {
            updatedContent = updatedContent.replace(/MEMORY_LIMIT_MB=.*/g, `MEMORY_LIMIT_MB=${newLimit}`);
          } else {
            updatedContent += `\nMEMORY_LIMIT_MB=${newLimit}`;
          }
          process.env.MEMORY_LIMIT_MB = newLimit.toString();
          changes.push(`Memory Limit: ${currentLimit === 0 ? 'No limit' : `${currentLimit}MB`} → ${newLimit === 0 ? 'No limit' : `${newLimit}MB`}`);
        }
        
        // Update warning threshold
        if (newWarn !== null) {
          if (updatedContent.includes('MEMORY_WARN_THRESHOLD=')) {
            updatedContent = updatedContent.replace(/MEMORY_WARN_THRESHOLD=.*/g, `MEMORY_WARN_THRESHOLD=${newWarn}`);
          } else {
            updatedContent += `\nMEMORY_WARN_THRESHOLD=${newWarn}`;
          }
          process.env.MEMORY_WARN_THRESHOLD = newWarn.toString();
          changes.push(`Warning Threshold: ${Math.round(currentWarn * 100)}% → ${Math.round(newWarn * 100)}%`);
        }
        
        // Update critical threshold
        if (newCritical !== null) {
          if (updatedContent.includes('MEMORY_CRITICAL_THRESHOLD=')) {
            updatedContent = updatedContent.replace(/MEMORY_CRITICAL_THRESHOLD=.*/g, `MEMORY_CRITICAL_THRESHOLD=${newCritical}`);
          } else {
            updatedContent += `\nMEMORY_CRITICAL_THRESHOLD=${newCritical}`;
          }
          process.env.MEMORY_CRITICAL_THRESHOLD = newCritical.toString();
          changes.push(`Critical Threshold: ${Math.round(currentCritical * 100)}% → ${Math.round(newCritical * 100)}%`);
        }
        
        // Update check frequency
        if (newFrequency !== null) {
          if (updatedContent.includes('MEMORY_CHECK_FREQUENCY=')) {
            updatedContent = updatedContent.replace(/MEMORY_CHECK_FREQUENCY=.*/g, `MEMORY_CHECK_FREQUENCY=${newFrequency}`);
          } else {
            updatedContent += `\nMEMORY_CHECK_FREQUENCY=${newFrequency}`;
          }
          process.env.MEMORY_CHECK_FREQUENCY = newFrequency.toString();
          changes.push(`Check Frequency: ${currentFrequency === 0 ? 'Adaptive' : `${currentFrequency}s`} → ${newFrequency === 0 ? 'Adaptive' : `${newFrequency}s`}`);
        }
        
        // Write updated .env file
        try {
          await fs.writeFile(envPath, updatedContent, 'utf8');
        } catch (error) {
          return interaction.editReply({
            content: `❌ Could not update .env file: ${error.message}`,
            ephemeral: true
          });
        }
        
        // Log changes
        logger.info(`Memory settings updated: ${changes.join(', ')}`);
        
        return interaction.editReply({
          content: `✅ Memory settings updated successfully!\n\n` +
                  `**Changes:**\n` +
                  changes.map(change => `• ${change}`).join('\n') + 
                  `\n\nThe new settings are now active. Use \`/optimize status\` to see current memory usage.`,
          ephemeral: true
        });
      } catch (error) {
        logger.error(`Error configuring memory settings: ${error.message}`);
        return interaction.editReply({
          content: `❌ Failed to configure memory settings: ${error.message}`,
          ephemeral: true
        });
      }
    }
  },
}; 