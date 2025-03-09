const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user from the server')
    .addUserOption(option => option.setName('user').setDescription('The user to kick').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason for the kick').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  cooldown: 5,
  async execute(interaction, client) {
    try {
      const guildId = interaction.guild.id;
      const guild = interaction.guild;
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const moderator = interaction.user;

      // Check if bot has permission to kick
      if (!guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
        logger.warn(`Kick command failed: Bot lacks KickMembers permission in guild ${guildId}`);
        return interaction.reply({ 
          content: '❌ I don\'t have permission to kick members!', 
          ephemeral: true 
        });
      }

      // Fetch guild member to check if they're kickable
      let targetMember;
      try {
        targetMember = await guild.members.fetch(targetUser.id);
      } catch (error) {
        logger.warn(`Kick command failed: User ${targetUser.tag} (${targetUser.id}) is not in the server ${guildId}`);
        return interaction.reply({ 
          content: '❌ This user is not in the server and cannot be kicked!', 
          ephemeral: true 
        });
      }

      // Check if user trying to kick themselves
      if (targetMember.id === moderator.id) {
        logger.warn(`Kick command failed: User ${moderator.tag} tried to kick themselves in guild ${guildId}`);
        return interaction.reply({ 
          content: '❌ You cannot kick yourself!', 
          ephemeral: true 
        });
      }
      
      // Check if target is kickable
      if (!targetMember.kickable) {
        logger.warn(`Kick command failed: Target ${targetUser.tag} is not kickable in guild ${guildId}`);
        return interaction.reply({ 
          content: '❌ I cannot kick this user! They may have higher permissions than me.', 
          ephemeral: true 
        });
      }

      // Check if moderator is trying to kick someone with higher roles
      if (interaction.member.roles.highest.position <= targetMember.roles.highest.position) {
        logger.warn(`Kick command failed: Moderator ${moderator.tag} tried to kick user ${targetUser.tag} with higher role in guild ${guildId}`);
        return interaction.reply({
          content: '❌ You cannot kick this user because they have the same or higher role than you!',
          ephemeral: true
        });
      }

      // Defered reply since kick operation could take time
      await interaction.deferReply();

      try {
        // Send DM to user if possible
        try {
          const dmEmbed = new EmbedBuilder()
            .setColor('#FF9900')
            .setTitle('👢 You have been kicked')
            .setDescription(`You have been kicked from **${guild.name}**`)
            .addFields(
              { name: 'Reason', value: reason },
              { name: 'Moderator', value: moderator.tag }
            )
            .setTimestamp();
          
          await targetUser.send({ embeds: [dmEmbed] });
          logger.info(`Kick notification DM sent to ${targetUser.tag} for guild ${guildId}`);
        } catch (error) {
          logger.warn(`Could not send kick DM to ${targetUser.tag} for guild ${guildId}: ${error.message}`);
        }

        // Execute the kick
        await targetMember.kick(`${reason} | Kicked by ${moderator.tag}`);
        logger.info(`User ${targetUser.tag} (${targetUser.id}) was kicked from guild ${guildId} by ${moderator.tag} for: ${reason}`);

        // Create success embed
        const successEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('👢 User Kicked')
          .setDescription(`**${targetUser.tag}** has been kicked from the server.`)
          .addFields(
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Reason', value: reason, inline: true },
            { name: 'Kicked by', value: moderator.tag, inline: true }
          )
          .setTimestamp();

        // Log to mod channel if configured
        const modLogChannelId = client.settings.get(`${guildId}:modLogChannel`);
        if (modLogChannelId) {
          try {
            const modLogChannel = await guild.channels.fetch(modLogChannelId);
            if (modLogChannel && modLogChannel.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)) {
              await modLogChannel.send({ embeds: [successEmbed] });
              logger.info(`Kick action logged to mod channel in guild ${guildId}`);
            }
          } catch (error) {
            logger.warn(`Failed to log kick to mod channel in guild ${guildId}: ${error.message}`);
          }
        }

        await interaction.editReply({ embeds: [successEmbed] });
      } catch (error) {
        logger.error(`Failed to kick user ${targetUser.id} in guild ${guildId}:`, error);
        await interaction.editReply({ 
          content: `❌ Failed to kick ${targetUser.tag}: ${error.message}`,
          ephemeral: true 
        });
      }
    } catch (error) {
      logger.error(`Kick command error in guild ${interaction.guild.id}:`, error);
      if (interaction.deferred) {
        await interaction.editReply({ content: '❌ An error occurred while executing the kick command.' });
      } else {
        await interaction.reply({ content: '❌ An error occurred while executing the kick command.', ephemeral: true });
      }
    }
  },
};