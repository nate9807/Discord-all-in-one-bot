const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user.')
    .addStringOption(option => option.setName('userid').setDescription('User ID').setRequired(true)),
  cooldown: 5,
  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return interaction.reply({ content: 'You need Ban Members permissions!', ephemeral: true });
    }
    const userId = interaction.options.getString('userid');
    await interaction.guild.members.unban(userId);
    const embed = new EmbedBuilder()
      .setTitle('User Unbanned')
      .setDescription(`User ID **${userId}** unbanned.`)
      .setColor('#00FF00')
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });

    const modlogChannelId = client.settings.get(`${interaction.guild.id}:modlog`);
    if (modlogChannelId) {
      const modlogChannel = client.channels.cache.get(modlogChannelId);
      if (modlogChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('Unban Log')
          .setDescription(`**User ID:** ${userId}\n**Action:** Unban\n**Moderator:** ${interaction.user.tag}`)
          .setColor('#00FF00')
          .setTimestamp();
        modlogChannel.send({ embeds: [logEmbed] });
      }
    }
  },
};