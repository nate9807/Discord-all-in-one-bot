const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');
const chrono = require('chrono-node');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set a smart reminder with natural language time')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('When to remind you (e.g., "in 2 hours", "tomorrow at 3pm")')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('What to remind you about')
        .setRequired(true))
    .addBooleanOption(option =>
      option.setName('private')
        .setDescription('Whether to send the reminder privately')
        .setRequired(false)),

  cooldown: 3,

  async execute(interaction, client) {
    try {
      const timeStr = interaction.options.getString('time');
      const message = interaction.options.getString('message');
      const isPrivate = interaction.options.getBoolean('private') ?? false;

      // Parse the time string using chrono-node
      const parsedDate = chrono.parseDate(timeStr, new Date(), { forwardDate: true });

      if (!parsedDate) {
        return await interaction.reply({
          content: 'I couldn\'t understand that time format. Try something like "in 2 hours" or "tomorrow at 3pm".',
          ephemeral: true
        });
      }

      const now = new Date();
      const duration = parsedDate.getTime() - now.getTime();

      // Check if the time is in the future and within reasonable bounds
      if (duration < 0) {
        return await interaction.reply({
          content: 'The reminder time must be in the future!',
          ephemeral: true
        });
      }

      if (duration > 30 * 24 * 60 * 60 * 1000) { // 30 days
        return await interaction.reply({
          content: 'Reminders can\'t be set more than 30 days in advance.',
          ephemeral: true
        });
      }

      // Store the reminder in memory (you might want to use a database in production)
      const reminder = {
        userId: interaction.user.id,
        channelId: interaction.channel.id,
        message: message,
        time: parsedDate,
        isPrivate: isPrivate
      };

      // Set the timeout for the reminder
      setTimeout(async () => {
        try {
          const channel = await client.channels.fetch(reminder.channelId);
          const user = await client.users.fetch(reminder.userId);

          const reminderEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('⏰ Reminder')
            .setDescription(reminder.message)
            .setFooter({ text: `Reminder set by ${user.tag}` })
            .setTimestamp();

          if (reminder.isPrivate) {
            await user.send({ embeds: [reminderEmbed] });
          } else {
            await channel.send({
              content: `<@${reminder.userId}>`,
              embeds: [reminderEmbed]
            });
          }
        } catch (error) {
          logger.error('Error sending reminder:', error);
        }
      }, duration);

      // Send confirmation
      const confirmEmbed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('⏰ Reminder Set')
        .setDescription(`I'll remind you: ${message}`)
        .addFields(
          { name: 'When', value: `<t:${Math.floor(parsedDate.getTime() / 1000)}:R>`, inline: true },
          { name: 'Where', value: isPrivate ? 'DM' : 'This channel', inline: true }
        )
        .setFooter({ text: 'You can set multiple reminders at once' })
        .setTimestamp();

      await interaction.reply({
        embeds: [confirmEmbed],
        ephemeral: isPrivate
      });

      logger.info(`Reminder set by ${interaction.user.tag} for ${parsedDate.toISOString()}`);
    } catch (error) {
      logger.error('Error in remind command:', error);
      await interaction.reply({
        content: 'There was an error setting your reminder. Please try again.',
        ephemeral: true
      });
    }
  }
}; 