const { Events, Collection } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // Handle command interactions
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      // Cooldown handling
      const { cooldowns } = client;
      if (!cooldowns.has(command.data.name)) {
        cooldowns.set(command.data.name, new Collection());
      }

      const now = Date.now();
      const timestamps = cooldowns.get(command.data.name);
      const cooldownAmount = (command.cooldown || 3) * 1000;

      if (timestamps.has(interaction.user.id)) {
        const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
        if (now < expirationTime) {
          const timeLeft = (expirationTime - now) / 1000;
          return interaction.reply({
            content: `Please wait ${timeLeft.toFixed(1)} more second(s) before using the \`${command.data.name}\` command.`,
            ephemeral: true
          });
        }
      }

      timestamps.set(interaction.user.id, now);
      setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

      try {
        await command.execute(interaction, client);
      } catch (error) {
        logger.error(`Error executing command ${interaction.commandName}:`, error);
        const errorMessage = {
          content: 'There was an error executing this command!',
          ephemeral: true
        };
        
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      }
    }
    // Handle help menu interactions
    else if (interaction.isStringSelectMenu() || interaction.isButton()) {
      // First check if this is a help menu interaction
      const isHelpInteraction = interaction.customId === 'help_category_select' || 
                              interaction.customId === 'help_main_menu';
      
      if (isHelpInteraction) {
        const helpCommand = client.commands.get('help');
        if (!helpCommand) return;

        try {
          // Try to acknowledge the interaction, but don't block on failure
          let acknowledged = false;
          if (!interaction.replied && !interaction.deferred) {
            try {
              await interaction.deferUpdate().catch(error => {
                logger.warn(`Could not defer help menu interaction: ${error.message}`);
              });
              acknowledged = true;
            } catch (deferError) {
              logger.warn(`Could not defer help menu interaction: ${deferError.message}`);
            }
          } else {
            acknowledged = true;
          }

          // Extract necessary info before attempting to handle
          const isSelectMenu = interaction.isStringSelectMenu();
          const isMainMenuButton = interaction.isButton() && interaction.customId === 'help_main_menu';
          const selectedCategory = isSelectMenu ? interaction.values[0] : null;
          
          // If we couldn't acknowledge the interaction but we have the channel, 
          // fall back to sending a new message
          let responseData = null;
          
          // Process based on interaction type
          if (isSelectMenu && interaction.customId === 'help_category_select') {
            // If the interaction was acknowledged, use it
            if (acknowledged) {
              await helpCommand.displayCategory(interaction, client, selectedCategory);
            } else if (interaction.channel) {
              // Otherwise create a new message
              responseData = await helpCommand.getCategoryData(client, selectedCategory);
              await interaction.channel.send(responseData).catch(error => {
                logger.error(`Failed to send help category to channel: ${error.message}`);
              });
            }
          } else if (isMainMenuButton) {
            // If the interaction was acknowledged, use it
            if (acknowledged) {
              await helpCommand.displayMainHelp(interaction, client);
            } else if (interaction.channel) {
              // Otherwise create a new message
              responseData = await helpCommand.getMainHelpData(client);
              await interaction.channel.send(responseData).catch(error => {
                logger.error(`Failed to send main help to channel: ${error.message}`);
              });
            }
          }
        } catch (error) {
          logger.error(`Error handling help menu interaction:`, error);
          
          // Try to send error message through any available means
          const errorMessage = {
            content: 'There was an error handling the help menu interaction! Please try again.',
            ephemeral: true
          };
          
          try {
            // First try interaction methods if they're likely to work
            if (interaction.deferred || interaction.replied) {
              await interaction.followUp(errorMessage).catch(e => 
                logger.error(`Failed to follow up with error message: ${e.message}`)
              );
            } else if (!interaction.replied && !interaction.deferred) {
              await interaction.reply(errorMessage).catch(e => 
                logger.error(`Failed to reply with error message: ${e.message}`)
              );
            } 
            // If interaction methods fail, try sending to the channel
            else if (interaction.channel) {
              await interaction.channel.send({
                content: `${interaction.user}, there was an error displaying the help menu. Please try again.`,
                allowedMentions: { users: [interaction.user.id] }
              }).catch(e => 
                logger.error(`Failed to send error message to channel: ${e.message}`)
              );
            }
          } catch (followupError) {
            logger.error('Error sending error message:', followupError);
          }
        }
      }
      // If it's not a help interaction, it might be a reaction menu interaction
      else if (interaction.customId.startsWith('set_') || 
              interaction.customId === 'channel_select' || 
              interaction.customId === 'start_setup' ||
              interaction.customId === 'to_roles' ||
              interaction.customId.startsWith('role_')) {
        // These are handled directly by the reactionmenu command collector
        // Do nothing here, as they're already being processed by the collector
        return;
      }
      // For any other custom interactions, try to find an appropriate handler
      else {
        try {
          // Check if the interaction is for custom user interfaces
          const customId = interaction.customId;
          // We could implement a more sophisticated lookup here
          logger.info(`Received unhandled component interaction: ${customId}`);
        } catch (error) {
          logger.error(`Error handling custom component:`, error);
        }
      }
    }
  },
}; 