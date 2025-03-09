const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete multiple messages at once')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Number of messages to delete (max 10000)')
        .setMinValue(1)
        .setMaxValue(10000)
        .setRequired(true))
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Only delete messages from this user')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('contains')
        .setDescription('Only delete messages containing this text')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  cooldown: 3,

  async execute(interaction, client) {
    try {
      const amount = interaction.options.getInteger('amount');
      const user = interaction.options.getUser('user');
      const contains = interaction.options.getString('contains')?.toLowerCase();

      // Defer the reply since this might take a while
      await interaction.deferReply({ ephemeral: true });

      let totalDeleted = 0;
      let failedBatches = 0;
      const batchSize = 100; // Discord's limit per deletion
      let lastMessageId = null;

      // Keep fetching and deleting messages until we reach the desired amount
      while (totalDeleted < amount) {
        try {
          // Calculate how many messages to fetch in this batch
          const remaining = amount - totalDeleted;
          const fetchAmount = Math.min(remaining, batchSize);

          // Fetch messages
          const messages = await interaction.channel.messages.fetch({
            limit: fetchAmount,
            before: lastMessageId || undefined
          });

          if (messages.size === 0) break; // No more messages to delete

          // Filter messages if needed
          let filteredMessages = messages;
          if (user || contains) {
            filteredMessages = messages.filter(msg => {
              const matchesUser = user ? msg.author.id === user.id : true;
              const matchesContent = contains ? msg.content.toLowerCase().includes(contains) : true;
              const isNotTooOld = msg.createdTimestamp > Date.now() - 1209600000; // 14 days
              return matchesUser && matchesContent && isNotTooOld;
            });
          }

          if (filteredMessages.size === 0) {
            // If no messages match our criteria, update lastMessageId and continue
            lastMessageId = messages.last().id;
            continue;
          }

          // Delete the filtered messages
          const deleted = await interaction.channel.bulkDelete(filteredMessages, true)
            .catch(error => {
              logger.error(`Error in purge batch: ${error}`);
              failedBatches++;
              return null;
            });

          if (deleted) {
            totalDeleted += deleted.size;
            lastMessageId = messages.last().id;

            // Progress update every 500 messages
            if (totalDeleted % 500 === 0 || totalDeleted === amount) {
              await interaction.editReply({
                content: `🗑️ Progress: ${totalDeleted}/${amount} messages deleted...`,
                ephemeral: true
              });
            }
          }

          // Small delay to prevent rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(`Error in purge loop: ${error}`);
          break;
        }
      }

      // Send final result
      const finalMessage = totalDeleted > 0
        ? `✅ Successfully deleted ${totalDeleted} message${totalDeleted !== 1 ? 's' : ''}.${failedBatches > 0 ? `\n⚠️ ${failedBatches} batch(es) failed to delete.` : ''}`
        : '❌ No messages were found matching your criteria or they were too old to delete.';

      await interaction.editReply({
        content: finalMessage,
        ephemeral: true
      });

      // Log the action
      logger.info(`${interaction.user.tag} purged ${totalDeleted} messages in #${interaction.channel.name}`);

      // Send to audit log if configured
      const modlogChannelId = client.settings.get(`${interaction.guild.id}:modlog`);
      if (modlogChannelId) {
        const modlogChannel = await interaction.guild.channels.fetch(modlogChannelId);
        if (modlogChannel) {
          await modlogChannel.send({
            content: `🗑️ **Purge Action**\n` +
              `**Moderator:** ${interaction.user.tag}\n` +
              `**Channel:** ${interaction.channel.name}\n` +
              `**Messages Deleted:** ${totalDeleted}\n` +
              `**Filters:** ${[
                user ? `User: ${user.tag}` : null,
                contains ? `Contains: "${contains}"` : null
              ].filter(Boolean).join(', ') || 'None'}`
          });
        }
      }
    } catch (error) {
      logger.error('Error in purge command:', error);
      const errorMessage = {
        content: '❌ An error occurred while purging messages. Please try again.',
        ephemeral: true
      };

      if (interaction.deferred) {
        await interaction.editReply(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  }
};