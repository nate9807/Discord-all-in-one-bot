const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user from the server')
    .addStringOption(option => option.setName('userid').setDescription('The user ID to unban').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the unban').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  cooldown: 5,
  async execute(interaction, client) {
    try {
      const guildId = interaction.guild.id;
      const guild = interaction.guild;
      const userId = interaction.options.getString('userid');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const moderator = interaction.user;

      // Check if bot has permission to unban
      if (!guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
        logger.warn(`Unban command failed: Bot lacks BanMembers permission in guild ${guildId}`);
        return interaction.reply({ 
          content: '❌ I don\'t have permission to unban users!', 
          ephemeral: true 
        });
      }

      // Validate user ID format
      if (!/^\d{17,20}$/.test(userId)) {
        logger.warn(`Unban command failed: Invalid user ID format "${userId}" in guild ${guildId}`);
        return interaction.reply({ 
          content: '❌ Invalid user ID format. Please provide a valid Discord user ID.',
          ephemeral: true 
        });
      }

      // Defer reply since fetching bans could take time
      await interaction.deferReply();

      try {
        // Check if the user is actually banned
        const bans = await guild.bans.fetch();
        const bannedUser = bans.find(ban => ban.user.id === userId);

        if (!bannedUser) {
          logger.warn(`Unban command failed: User ID ${userId} is not banned in guild ${guildId}`);
          return interaction.editReply({ 
            content: '❌ This user is not banned!',
            ephemeral: true 
          });
        }

        // Perform the unban
        await guild.members.unban(userId, `${reason} | Unbanned by ${moderator.tag}`);
        logger.info(`User ${bannedUser.user.tag} (${userId}) was unbanned from guild ${guildId} by ${moderator.tag} for: ${reason}`);

        // Create success embed
        const successEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('🔓 User Unbanned')
          .setDescription(`**${bannedUser.user.tag}** has been unbanned from the server.`)
          .addFields(
            { name: 'User ID', value: userId, inline: true },
            { name: 'Reason', value: reason, inline: true },
            { name: 'Unbanned by', value: moderator.tag, inline: true }
          )
          .setTimestamp();

        // Log to mod channel if configured
        const modLogChannelId = client.settings.get(`${guildId}:modLogChannel`);
        if (modLogChannelId) {
          try {
            const modLogChannel = await guild.channels.fetch(modLogChannelId);
            if (modLogChannel && modLogChannel.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)) {
              await modLogChannel.send({ embeds: [successEmbed] });
              logger.info(`Unban action logged to mod channel in guild ${guildId}`);
            }
          } catch (error) {
            logger.warn(`Failed to log unban to mod channel in guild ${guildId}: ${error.message}`);
          }
        }

        await interaction.editReply({ embeds: [successEmbed] });
      } catch (error) {
        logger.error(`Failed to unban user ${userId} in guild ${guildId}:`, error);
        await interaction.editReply({ 
          content: `❌ Failed to unban user: ${error.message}`,
          ephemeral: true 
        });
      }
    } catch (error) {
      logger.error(`Unban command error in guild ${interaction.guild.id}:`, error);
      if (interaction.deferred) {
        await interaction.editReply({ content: '❌ An error occurred while executing the unban command.' });
      } else {
        await interaction.reply({ content: '❌ An error occurred while executing the unban command.', ephemeral: true });
      }
    }
  },
};