const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server')
    .addUserOption(option => option.setName('user').setDescription('The user to ban').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the ban').setRequired(false))
    .addNumberOption(option => option.setName('days').setDescription('Number of days of messages to delete (0-7)').setMinValue(0).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  cooldown: 5,
  async execute(interaction, client) {
    try {
      const guildId = interaction.guild.id;
      const guild = interaction.guild;
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const days = interaction.options.getNumber('days') || 0;
      const moderator = interaction.user;

      // Check if bot has permission to ban
      if (!guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
        logger.warn(`Ban command failed: Bot lacks BanMembers permission in guild ${guildId}`);
        return interaction.reply({ 
          content: '❌ I don\'t have permission to ban members!', 
          ephemeral: true 
        });
      }

      // Fetch guild member to check if they're bannable
      try {
        const targetMember = await guild.members.fetch(targetUser.id);
        
        // Check if user trying to ban themselves
        if (targetMember.id === moderator.id) {
          logger.warn(`Ban command failed: User ${moderator.tag} tried to ban themselves in guild ${guildId}`);
          return interaction.reply({ 
            content: '❌ You cannot ban yourself!', 
            ephemeral: true 
          });
        }
        
        // Check if target is bannable
        if (!targetMember.bannable) {
          logger.warn(`Ban command failed: Target ${targetUser.tag} is not bannable in guild ${guildId}`);
          return interaction.reply({ 
            content: '❌ I cannot ban this user! They may have higher permissions than me.', 
            ephemeral: true 
          });
        }

        // Check if moderator is trying to ban someone with higher roles
        if (interaction.member.roles.highest.position <= targetMember.roles.highest.position) {
          logger.warn(`Ban command failed: Moderator ${moderator.tag} tried to ban user ${targetUser.tag} with higher role in guild ${guildId}`);
          return interaction.reply({
            content: '❌ You cannot ban this user because they have the same or higher role than you!',
            ephemeral: true
          });
        }
      } catch (error) {
        // User might not be in the server, but we can still ban their ID
        logger.info(`Ban command: User ${targetUser.id} not in server or could not be fetched in guild ${guildId}`);
      }

      // Defered reply since ban operation could take time
      await interaction.deferReply();

      try {
        // Send DM to user if possible
        try {
          const dmEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('🔨 You have been banned')
            .setDescription(`You have been banned from **${guild.name}**`)
            .addFields(
              { name: 'Reason', value: reason },
              { name: 'Moderator', value: moderator.tag }
            )
            .setTimestamp();
          
          await targetUser.send({ embeds: [dmEmbed] });
          logger.info(`Ban notification DM sent to ${targetUser.tag} for guild ${guildId}`);
        } catch (error) {
          logger.warn(`Could not send ban DM to ${targetUser.tag} for guild ${guildId}: ${error.message}`);
        }

        // Execute the ban
        await guild.members.ban(targetUser, { 
          reason: `${reason} | Banned by ${moderator.tag}`,
          deleteMessageDays: days
        });

        logger.info(`User ${targetUser.tag} (${targetUser.id}) was banned from guild ${guildId} by ${moderator.tag} for: ${reason}`);

        // Create success embed
        const successEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('🔨 User Banned')
          .setDescription(`**${targetUser.tag}** has been banned from the server.`)
          .addFields(
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Reason', value: reason, inline: true },
            { name: 'Messages Deleted', value: `${days} day(s)`, inline: true },
            { name: 'Banned by', value: moderator.tag }
          )
          .setTimestamp();

        // Log to mod channel if configured
        const modLogChannelId = client.settings.get(`${guildId}:modLogChannel`);
        if (modLogChannelId) {
          try {
            const modLogChannel = await guild.channels.fetch(modLogChannelId);
            if (modLogChannel && modLogChannel.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)) {
              await modLogChannel.send({ embeds: [successEmbed] });
              logger.info(`Ban action logged to mod channel in guild ${guildId}`);
            }
          } catch (error) {
            logger.warn(`Failed to log ban to mod channel in guild ${guildId}: ${error.message}`);
          }
        }

        await interaction.editReply({ embeds: [successEmbed] });
      } catch (error) {
        logger.error(`Failed to ban user ${targetUser.id} in guild ${guildId}:`, error);
        await interaction.editReply({ 
          content: `❌ Failed to ban ${targetUser.tag}: ${error.message}`,
          ephemeral: true 
        });
      }
    } catch (error) {
      logger.error(`Ban command error in guild ${interaction.guild.id}:`, error);
      if (interaction.deferred) {
        await interaction.editReply({ content: '❌ An error occurred while executing the ban command.' });
      } else {
        await interaction.reply({ content: '❌ An error occurred while executing the ban command.', ephemeral: true });
      }
    }
  },
};