const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user for rule violations')
    .addUserOption(option => option.setName('user').setDescription('The user to warn').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the warning').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  cooldown: 5,
  async execute(interaction, client) {
    try {
      const guildId = interaction.guild.id;
      const guild = interaction.guild;
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const moderator = interaction.user;
      const warningId = generateWarningId();
      const timestamp = Date.now();

      // Check if target is a bot
      if (targetUser.bot) {
        logger.warn(`Warn command failed: User ${moderator.tag} tried to warn a bot in guild ${guildId}`);
        return interaction.reply({ 
          content: '❌ You cannot warn bots!', 
          ephemeral: true 
        });
      }

      // Check if user trying to warn themselves
      if (targetUser.id === moderator.id) {
        logger.warn(`Warn command failed: User ${moderator.tag} tried to warn themselves in guild ${guildId}`);
        return interaction.reply({ 
          content: '❌ You cannot warn yourself!', 
          ephemeral: true 
        });
      }

      // Ensure data directory exists
      const dataDir = path.join(__dirname, '../data');
      const warningsDir = path.join(dataDir, 'warnings');
      
      try {
        await fs.mkdir(dataDir, { recursive: true });
        await fs.mkdir(warningsDir, { recursive: true });
      } catch (error) {
        logger.error(`Failed to create warnings directory:`, error);
      }

      // Prepare warning data
      const warningData = {
        id: warningId,
        userId: targetUser.id,
        userTag: targetUser.tag,
        guildId: guildId,
        guildName: guild.name,
        reason: reason,
        moderatorId: moderator.id,
        moderatorTag: moderator.tag,
        timestamp: timestamp,
        date: new Date(timestamp).toISOString()
      };

      // Get existing warnings or start with empty array
      const warningsFile = path.join(warningsDir, `${guildId}.json`);
      let warnings = [];
      
      try {
        const data = await fs.readFile(warningsFile, 'utf8');
        warnings = JSON.parse(data);
      } catch (error) {
        // File might not exist yet, that's okay
        logger.info(`No existing warnings file for guild ${guildId}, creating new one`);
      }

      // Add new warning
      warnings.push(warningData);

      // Save warnings
      await fs.writeFile(warningsFile, JSON.stringify(warnings, null, 2), 'utf8');

      // Count user's warnings
      const userWarnings = warnings.filter(w => w.userId === targetUser.id);
      const warningCount = userWarnings.length;

      logger.info(`User ${targetUser.tag} (${targetUser.id}) was warned in guild ${guildId} by ${moderator.tag} for: ${reason}`);
      logger.info(`This is warning #${warningCount} for ${targetUser.tag} in guild ${guildId}`);

      // Try to DM the user about the warning
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor('#FFCC00')
          .setTitle('⚠️ You have been warned')
          .setDescription(`You have received a warning in **${guild.name}**`)
          .addFields(
            { name: 'Reason', value: reason },
            { name: 'Warning ID', value: warningId },
            { name: 'Total Warnings', value: `${warningCount}` },
            { name: 'Moderator', value: moderator.tag }
          )
          .setFooter({ text: 'Multiple warnings may result in mutes or bans' })
          .setTimestamp();
        
        await targetUser.send({ embeds: [dmEmbed] });
        logger.info(`Warning notification DM sent to ${targetUser.tag} for guild ${guildId}`);
      } catch (error) {
        logger.warn(`Could not send warning DM to ${targetUser.tag} for guild ${guildId}: ${error.message}`);
      }

      // Create success embed
      const successEmbed = new EmbedBuilder()
        .setColor('#FFCC00')
        .setTitle('⚠️ User Warned')
        .setDescription(`**${targetUser.tag}** has been warned.`)
        .addFields(
          { name: 'User ID', value: targetUser.id, inline: true },
          { name: 'Reason', value: reason, inline: true },
          { name: 'Warning ID', value: warningId, inline: true },
          { name: 'Total Warnings', value: `${warningCount}`, inline: true },
          { name: 'Warned by', value: moderator.tag, inline: true }
        )
        .setTimestamp();

      // Log to mod channel if configured
      const modLogChannelId = client.settings.get(`${guildId}:modLogChannel`);
      if (modLogChannelId) {
        try {
          const modLogChannel = await guild.channels.fetch(modLogChannelId);
          if (modLogChannel && modLogChannel.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)) {
            await modLogChannel.send({ embeds: [successEmbed] });
            logger.info(`Warning action logged to mod channel in guild ${guildId}`);
          }
        } catch (error) {
          logger.warn(`Failed to log warning to mod channel in guild ${guildId}: ${error.message}`);
        }
      }

      await interaction.reply({ embeds: [successEmbed] });

      // Moderate based on warning count if configured
      const autoModerate = client.settings.get(`${guildId}:warnAutoModerate`);
      if (autoModerate && warningCount >= 3) {
        try {
          // For 3rd warning, timeout for 1 hour
          if (warningCount === 3) {
            const targetMember = await guild.members.fetch(targetUser.id);
            if (targetMember && targetMember.moderatable) {
              await targetMember.timeout(3600000, `Automatic timeout after 3 warnings | Last warning by ${moderator.tag}`);
              logger.info(`User ${targetUser.tag} automatically timed out for 1 hour after receiving 3 warnings in guild ${guildId}`);
              
              const timeoutEmbed = new EmbedBuilder()
                .setColor('#FF9900')
                .setTitle('🔇 Automatic Timeout')
                .setDescription(`**${targetUser.tag}** has been automatically timed out for 1 hour after receiving 3 warnings.`)
                .setTimestamp();
              
              await interaction.channel.send({ embeds: [timeoutEmbed] });
            }
          }
          // For 5th warning, timeout for 1 day
          else if (warningCount === 5) {
            const targetMember = await guild.members.fetch(targetUser.id);
            if (targetMember && targetMember.moderatable) {
              await targetMember.timeout(86400000, `Automatic timeout after 5 warnings | Last warning by ${moderator.tag}`);
              logger.info(`User ${targetUser.tag} automatically timed out for 1 day after receiving 5 warnings in guild ${guildId}`);
              
              const timeoutEmbed = new EmbedBuilder()
                .setColor('#FF9900')
                .setTitle('🔇 Automatic Timeout')
                .setDescription(`**${targetUser.tag}** has been automatically timed out for 1 day after receiving 5 warnings.`)
                .setTimestamp();
              
              await interaction.channel.send({ embeds: [timeoutEmbed] });
            }
          }
        } catch (error) {
          logger.error(`Failed to auto-moderate user ${targetUser.id} after warnings in guild ${guildId}:`, error);
        }
      }
    } catch (error) {
      logger.error(`Warn command error in guild ${interaction.guild.id}:`, error);
      await interaction.reply({ 
        content: '❌ An error occurred while executing the warn command.',
        ephemeral: true 
      });
    }
  },
};

// Helper function to generate a unique warning ID
function generateWarningId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}