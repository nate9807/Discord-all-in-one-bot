const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restoresettings')
    .setDescription('Restore settings from a backup (Owner only)')
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

    await interaction.deferReply({ ephemeral: true });

    try {
      // Get backup directory
      const backupDir = path.join(__dirname, '../settings_backups');
      
      // Check if backup directory exists
      try {
        await fs.access(backupDir);
      } catch (error) {
        return interaction.editReply({
          content: 'No backups found. The backup directory does not exist.',
          ephemeral: true
        });
      }
      
      // Get list of backup files
      const files = await fs.readdir(backupDir);
      const backupFiles = files
        .filter(file => file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(backupDir, file),
          time: fs.statSync(path.join(backupDir, file)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time); // Sort newest first
      
      if (backupFiles.length === 0) {
        return interaction.editReply({
          content: 'No backup files found in the backup directory.',
          ephemeral: true
        });
      }
      
      // Get the most recent backup
      const latestBackup = backupFiles[0];
      
      // Read the backup file
      const backupData = await fs.readFile(latestBackup.path, 'utf8');
      const settings = JSON.parse(backupData);
      
      // Count settings
      const settingsCount = Object.keys(settings).length;
      
      // Create a backup of current settings before restoring
      const settingsFile = process.env.ABSOLUTE_SETTINGS_PATH;
      if (settingsFile) {
        try {
          const currentData = {};
          for (const [key, value] of client.settings.entries()) {
            currentData[key] = value;
          }
          
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const preRestoreBackup = path.join(backupDir, `pre_restore_${timestamp}.json`);
          await fs.writeFile(preRestoreBackup, JSON.stringify(currentData, null, 2), 'utf8');
          logger.info(`Created pre-restore backup at ${preRestoreBackup}`);
        } catch (error) {
          logger.error(`Failed to create pre-restore backup: ${error.message}`);
        }
      }
      
      // Restore settings
      client.settings.clear();
      for (const [key, value] of Object.entries(settings)) {
        client.settings.set(key, value);
      }
      
      // Save restored settings to file
      if (client.saveSettings) {
        await client.saveSettings();
        logger.info(`Saved restored settings to file`);
      }
      
      // Send success message
      return interaction.editReply({
        content: `✅ Successfully restored ${settingsCount} settings from backup: ${latestBackup.name}\n\nA backup of your previous settings was created before restoration.`,
        ephemeral: true
      });
    } catch (error) {
      logger.error(`Error restoring settings: ${error.message}`);
      return interaction.editReply({
        content: `❌ Failed to restore settings: ${error.message}`,
        ephemeral: true
      });
    }
  },
}; 