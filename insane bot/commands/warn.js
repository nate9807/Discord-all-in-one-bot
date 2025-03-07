const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user.')
    .addUserOption(option => option.setName('user').setDescription('The user').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false)),
  cooldown: 5,
  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.editReply({ content: 'You need Manage Messages permissions!' });
    }
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const embed = new EmbedBuilder()
      .setTitle('User Warned')
      .setDescription(`**${user.tag}** warned.\n**Reason:** ${reason}`)
      .setColor('#FFFF00')
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    await user.send({ embeds: [embed] }).catch(() => client.logger.warn(`Could not DM ${user.tag}`));

    const modlogChannelId = client.settings.get(`${interaction.guild.id}:modlog`);
    if (modlogChannelId) {
      const modlogChannel = client.channels.cache.get(modlogChannelId);
      if (modlogChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('Warn Log')
          .setDescription(`**User:** ${user.tag}\n**Action:** Warn\n**Reason:** ${reason}\n**Moderator:** ${interaction.user.tag}`)
          .setColor('#FFFF00')
          .setTimestamp();
        modlogChannel.send({ embeds: [logEmbed] });
      }
    }
  },
};