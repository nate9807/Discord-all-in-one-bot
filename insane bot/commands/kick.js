const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user.')
    .addUserOption(option => option.setName('user').setDescription('The user').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false)),
  cooldown: 5,
  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return interaction.reply({ content: 'You need Kick Members permissions!', ephemeral: true });
    }
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = await interaction.guild.members.fetch(user);
    await member.kick(reason);
    const embed = new EmbedBuilder()
      .setTitle('User Kicked')
      .setDescription(`**${user.tag}** has been kicked.\n**Reason:** ${reason}`)
      .setColor('#FFA500')
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });

    const modlogChannelId = client.settings.get(`${interaction.guild.id}:modlog`);
    if (modlogChannelId) {
      const modlogChannel = client.channels.cache.get(modlogChannelId);
      if (modlogChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('Kick Log')
          .setDescription(`**User:** ${user.tag}\n**Action:** Kick\n**Reason:** ${reason}\n**Moderator:** ${interaction.user.tag}`)
          .setColor('#FFA500')
          .setTimestamp();
        modlogChannel.send({ embeds: [logEmbed] });
      }
    }
  },
};