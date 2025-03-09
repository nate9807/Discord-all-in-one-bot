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
      const helpCommand = client.commands.get('help');
      if (!helpCommand) return;

      try {
        // Defer the interaction first
        await interaction.deferUpdate();

        // Handle select menu for category selection
        if (interaction.isStringSelectMenu() && interaction.customId === 'help_category_select') {
          const selectedCategory = interaction.values[0];
          await helpCommand.displayCategory(interaction, client, selectedCategory);
        }
        // Handle button for returning to main menu
        else if (interaction.isButton() && interaction.customId === 'help_main_menu') {
          await helpCommand.displayMainHelp(interaction, client);
        }
      } catch (error) {
        logger.error(`Error handling help menu interaction:`, error);
        try {
          const errorMessage = {
            content: 'There was an error handling the help menu interaction!',
            ephemeral: true
          };
          
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply(errorMessage);
          } else {
            await interaction.followUp(errorMessage);
          }
        } catch (followupError) {
          logger.error('Error sending error message:', followupError);
        }
      }
    }
  },
}; 