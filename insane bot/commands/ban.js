const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user.')
    .addUserOption(option => option.setName('user').setDescription('The user').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false)),
  cooldown: 5,
  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return interaction.reply({ content: 'You need Ban Members permissions!', ephemeral: true });
    }
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    await interaction.guild.members.ban(user, { reason });
    const embed = new EmbedBuilder()
      .setTitle('User Banned')
      .setDescription(`**${user.tag}** has been banned.\n**Reason:** ${reason}`)
      .setColor('#FF0000')
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });

    const modlogChannelId = client.settings.get(`${interaction.guild.id}:modlog`);
    if (modlogChannelId) {
      const modlogChannel = client.channels.cache.get(modlogChannelId);
      if (modlogChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('Ban Log')
          .setDescription(`**User:** ${user.tag}\n**Action:** Ban\n**Reason:** ${reason}\n**Moderator:** ${interaction.user.tag}`)
          .setColor('#FF0000')
          .setTimestamp();
        modlogChannel.send({ embeds: [logEmbed] });
      }
    }
  },
};