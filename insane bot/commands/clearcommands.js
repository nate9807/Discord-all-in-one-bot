const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearcommands')
    .setDescription('Clear all application commands from Discord (Owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  cooldown: 60, // 1 minute cooldown
  async execute(interaction, client) {
    // Check if user is the bot owner
    if (interaction.user.id !== process.env.OWNERID) {
      return interaction.reply({
        content: 'This command can only be used by the bot owner.',
        ephemeral: true
      });
    }

    // First message to warn about the consequences
    await interaction.reply({
      content: `⚠️ **Warning**: This will remove all slash commands from your bot. You will need to re-register them afterwards.\n\n` +
               `To re-register commands, you can either:\n` +
               `• Restart your bot (if you have auto-deploy on startup)\n` +
               `• Run your deploy commands script manually\n\n` +
               `Are you sure you want to proceed? Reply with \`yes\` to continue.`,
      ephemeral: true
    });

    // Wait for confirmation
    try {
      const filter = m => m.author.id === interaction.user.id && m.content.toLowerCase() === 'yes';
      const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
      
      // Delete the confirmation message
      try {
        await collected.first().delete();
      } catch (err) {
        // Ignore if we can't delete the message
      }
    } catch (error) {
      return interaction.editReply({
        content: 'Command cancelled - no confirmation received within 30 seconds.',
        ephemeral: true
      });
    }

    // Proceed with clearing commands
    await interaction.editReply({
      content: '🔄 Clearing commands...',
      ephemeral: true
    });

    try {
      // Clear global commands
      await client.application.commands.set([]);
      logger.info('Cleared global application commands');

      // Clear guild-specific commands from all guilds
      const guilds = await client.guilds.fetch();
      let clearedGuilds = 0;
      
      for (const [guildId, guild] of guilds) {
        try {
          const guildObj = await guild.fetch();
          await guildObj.commands.set([]);
          clearedGuilds++;
          logger.info(`Cleared commands from guild: ${guildObj.name} (${guildId})`);
        } catch (error) {
          logger.error(`Failed to clear commands from guild ${guildId}: ${error.message}`);
        }
      }

      await interaction.editReply({
        content: `✅ **Successfully cleared all commands!**\n\n` +
                `**What was cleared:**\n` +
                `• Global commands\n` +
                `• Commands from ${clearedGuilds} guilds\n\n` +
                `**IMPORTANT - Next Steps:**\n` +
                `To restore your commands, either:\n` +
                `1️⃣ Restart your bot (if auto-deploy is enabled)\n` +
                `2️⃣ Run your deploy commands script manually:\n` +
                `\`node deploy-commands.js\`\n\n` +
                `⚠️ Your bot won't respond to slash commands until you complete one of these steps!`,
        ephemeral: true
      });

    } catch (error) {
      logger.error('Error clearing commands:', error);
      await interaction.editReply({
        content: `❌ Failed to clear commands: ${error.message}`,
        ephemeral: true
      });
    }
  },
}; 