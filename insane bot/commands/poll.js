const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create an interactive poll')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('The poll question')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('options')
        .setDescription('Poll options (comma-separated)')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('Poll duration in minutes (max 1440)')
        .setMinValue(1)
        .setMaxValue(1440)
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('multiple')
        .setDescription('Allow multiple choices')
        .setRequired(false)),

  cooldown: 3,

  // Emoji numbers for up to 10 options
  numberEmojis: ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'],

  async execute(interaction, client) {
    try {
      const question = interaction.options.getString('question');
      const optionsString = interaction.options.getString('options');
      const duration = interaction.options.getInteger('duration') || 60; // Default 60 minutes
      const allowMultiple = interaction.options.getBoolean('multiple') ?? false;

      // Parse and validate options
      const options = optionsString.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);

      if (options.length < 2) {
        return await interaction.reply({
          content: 'Please provide at least 2 options for the poll.',
          ephemeral: true
        });
      }

      if (options.length > 10) {
        return await interaction.reply({
          content: 'You can only have up to 10 options in a poll.',
          ephemeral: true
        });
      }

      // Create the poll embed
      const embed = new EmbedBuilder()
        .setColor('#FF9300')
        .setTitle('📊 ' + question)
        .setDescription(
          `**Options:**\n${options.map((opt, i) => `${this.numberEmojis[i]} ${opt}`).join('\n')}\n\n` +
          `**Duration:** ${duration} minutes\n` +
          `**Multiple Choices:** ${allowMultiple ? 'Yes' : 'No'}\n\n` +
          'React with the corresponding number to vote!'
        )
        .setFooter({
          text: `Poll by ${interaction.user.tag} • Ends`,
          iconURL: interaction.user.displayAvatarURL({ dynamic: true })
        })
        .setTimestamp(Date.now() + duration * 60000);

      // Send the poll
      const pollMessage = await interaction.reply({
        embeds: [embed],
        fetchReply: true
      });

      // Add reaction options
      for (let i = 0; i < options.length; i++) {
        await pollMessage.react(this.numberEmojis[i]);
      }

      // Create collector for reactions
      const filter = (reaction, user) => {
        return this.numberEmojis.slice(0, options.length).includes(reaction.emoji.name) && !user.bot;
      };

      const collector = pollMessage.createReactionCollector({
        filter,
        time: duration * 60000
      });

      // Track votes
      const votes = new Map();
      const userVotes = new Map();

      collector.on('collect', async (reaction, user) => {
        try {
          if (!allowMultiple) {
            // Remove user's previous vote if they voted for a different option
            const previousVote = userVotes.get(user.id);
            if (previousVote && previousVote !== reaction.emoji.name) {
              const previousReaction = pollMessage.reactions.cache.get(previousVote);
              if (previousReaction) {
                await previousReaction.users.remove(user);
              }
            }
          }
          userVotes.set(user.id, reaction.emoji.name);
        } catch (error) {
          logger.error('Error handling poll vote:', error);
        }
      });

      collector.on('end', async () => {
        try {
          // Count final votes
          pollMessage.reactions.cache.forEach((reaction) => {
            if (this.numberEmojis.includes(reaction.emoji.name)) {
              votes.set(reaction.emoji.name, reaction.count - 1); // Subtract 1 for bot's reaction
            }
          });

          // Calculate results
          const totalVotes = Array.from(votes.values()).reduce((a, b) => a + b, 0);
          const results = options.map((opt, i) => {
            const emoji = this.numberEmojis[i];
            const voteCount = votes.get(emoji) || 0;
            const percentage = totalVotes > 0 ? (voteCount / totalVotes * 100).toFixed(1) : 0;
            const bar = this.createProgressBar(percentage);
            return `${emoji} ${opt}\n${bar} ${voteCount} votes (${percentage}%)`;
          });

          // Update embed with results
          const resultsEmbed = new EmbedBuilder()
            .setColor('#FF9300')
            .setTitle('📊 Poll Results: ' + question)
            .setDescription(
              `**Final Results:**\n\n${results.join('\n\n')}\n\n` +
              `**Total Votes:** ${totalVotes}`
            )
            .setFooter({
              text: `Poll by ${interaction.user.tag} • Ended`,
              iconURL: interaction.user.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();

          await pollMessage.edit({ embeds: [resultsEmbed] });
        } catch (error) {
          logger.error('Error ending poll:', error);
        }
      });

      logger.info(`Poll created by ${interaction.user.tag} with ${options.length} options`);
    } catch (error) {
      logger.error('Error in poll command:', error);
      await interaction.reply({
        content: 'There was an error creating the poll. Please try again.',
        ephemeral: true
      });
    }
  },

  createProgressBar(percentage) {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}; 