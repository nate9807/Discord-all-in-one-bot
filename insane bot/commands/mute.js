const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const ms = require('ms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout/mute a user for a specified duration')
    .addUserOption(option => option.setName('user').setDescription('The user to timeout/mute').setRequired(true))
    .addStringOption(option => 
      option.setName('duration')
        .setDescription('Duration of the timeout (e.g. 10m, 1h, 1d)')
        .setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the timeout').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  cooldown: 5,
  async execute(interaction, client) {
    try {
      const guildId = interaction.guild.id;
      const guild = interaction.guild;
      const targetUser = interaction.options.getUser('user');
      const durationString = interaction.options.getString('duration');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const moderator = interaction.user;

      // Check if bot has permission to timeout members
      if (!guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        logger.warn(`Mute command failed: Bot lacks ModerateMembers permission in guild ${guildId}`);
        return interaction.reply({ 
          content: '❌ I don\'t have permission to timeout/mute members!', 
          ephemeral: true 
        });
      }

      // Parse duration
      let durationMs;
      try {
        durationMs = ms(durationString);
        if (!durationMs || isNaN(durationMs)) {
          throw new Error('Invalid duration format');
        }

        // Check for Discord's maximum timeout duration (28 days)
        const maxTimeout = ms('28d');
        if (durationMs > maxTimeout) {
          logger.warn(`Mute command: Duration ${durationString} exceeds max 28 days in guild ${guildId}`);
          return interaction.reply({
            content: '❌ Timeout duration cannot exceed 28 days. Please use a shorter duration.',
            ephemeral: true
          });
        }
      } catch (error) {
        logger.warn(`Mute command failed: Invalid duration format "${durationString}" in guild ${guildId}`);
        return interaction.reply({
          content: '❌ Invalid duration format. Please use formats like 10s, 5m, 2h, 1d.',
          ephemeral: true
        });
      }

      // Fetch guild member to check if they can be timed out
      let targetMember;
      try {
        targetMember = await guild.members.fetch(targetUser.id);
      } catch (error) {
        logger.warn(`Mute command failed: User ${targetUser.tag} (${targetUser.id}) is not in the server ${guildId}`);
        return interaction.reply({ 
          content: '❌ This user is not in the server and cannot be timed out!', 
          ephemeral: true 
        });
      }

      // Check if user trying to mute themselves
      if (targetMember.id === moderator.id) {
        logger.warn(`Mute command failed: User ${moderator.tag} tried to timeout themselves in guild ${guildId}`);
        return interaction.reply({ 
          content: '❌ You cannot timeout yourself!', 
          ephemeral: true 
        });
      }
      
      // Check if target can be timed out
      if (!targetMember.moderatable) {
        logger.warn(`Mute command failed: Target ${targetUser.tag} cannot be timed out in guild ${guildId}`);
        return interaction.reply({ 
          content: '❌ I cannot timeout this user! They may have higher permissions than me.', 
          ephemeral: true 
        });
      }

      // Check if moderator is trying to mute someone with higher roles
      if (interaction.member.roles.highest.position <= targetMember.roles.highest.position) {
        logger.warn(`Mute command failed: Moderator ${moderator.tag} tried to timeout user ${targetUser.tag} with higher role in guild ${guildId}`);
        return interaction.reply({
          content: '❌ You cannot timeout this user because they have the same or higher role than you!',
          ephemeral: true
        });
      }

      // Defered reply since timeout operation could take time
      await interaction.deferReply();

      try {
        // Format the duration for display
        const readableDuration = formatDuration(durationMs);

        // Send DM to user if possible
        try {
          const dmEmbed = new EmbedBuilder()
            .setColor('#FFC107')
            .setTitle('🔇 You have been timed out')
            .setDescription(`You have been timed out in **${guild.name}** for **${readableDuration}**`)
            .addFields(
              { name: 'Reason', value: reason },
              { name: 'Expires', value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:R>` },
              { name: 'Moderator', value: moderator.tag }
            )
            .setTimestamp();
          
          await targetUser.send({ embeds: [dmEmbed] });
          logger.info(`Timeout notification DM sent to ${targetUser.tag} for guild ${guildId}`);
        } catch (error) {
          logger.warn(`Could not send timeout DM to ${targetUser.tag} for guild ${guildId}: ${error.message}`);
        }

        // Execute the timeout
        await targetMember.timeout(durationMs, `${reason} | Timed out by ${moderator.tag}`);
        logger.info(`User ${targetUser.tag} (${targetUser.id}) was timed out for ${readableDuration} in guild ${guildId} by ${moderator.tag} for: ${reason}`);

        // Create success embed
        const successEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('🔇 User Timed Out')
          .setDescription(`**${targetUser.tag}** has been timed out for **${readableDuration}**.`)
          .addFields(
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Reason', value: reason, inline: true },
            { name: 'Duration', value: readableDuration, inline: true },
            { name: 'Expires', value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:R>`, inline: true },
            { name: 'Timed out by', value: moderator.tag, inline: true }
          )
          .setTimestamp();

        // Log to mod channel if configured
        const modLogChannelId = client.settings.get(`${guildId}:modLogChannel`);
        if (modLogChannelId) {
          try {
            const modLogChannel = await guild.channels.fetch(modLogChannelId);
            if (modLogChannel && modLogChannel.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)) {
              await modLogChannel.send({ embeds: [successEmbed] });
              logger.info(`Timeout action logged to mod channel in guild ${guildId}`);
            }
          } catch (error) {
            logger.warn(`Failed to log timeout to mod channel in guild ${guildId}: ${error.message}`);
          }
        }

        await interaction.editReply({ embeds: [successEmbed] });
      } catch (error) {
        logger.error(`Failed to timeout user ${targetUser.id} in guild ${guildId}:`, error);
        await interaction.editReply({ 
          content: `❌ Failed to timeout ${targetUser.tag}: ${error.message}`,
          ephemeral: true 
        });
      }
    } catch (error) {
      logger.error(`Mute command error in guild ${interaction.guild.id}:`, error);
      if (interaction.deferred) {
        await interaction.editReply({ content: '❌ An error occurred while executing the timeout command.' });
      } else {
        await interaction.reply({ content: '❌ An error occurred while executing the timeout command.', ephemeral: true });
      }
    }
  },
};

// Helper function to format duration in human-readable format
function formatDuration(ms) {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);

  return parts.join(', ');
}