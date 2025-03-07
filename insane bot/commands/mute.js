const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a user.')
    .addUserOption(option => option.setName('user').setDescription('The user').setRequired(true))
    .addIntegerOption(option => option.setName('duration').setDescription('Duration (minutes)').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false)),
  cooldown: 5,
  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.MuteMembers)) {
      return interaction.editReply({ content: 'You need Mute Members permissions!' });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.MuteMembers)) {
      return interaction.editReply({ content: 'I need Mute Members permissions!' });
    }

    const user = interaction.options.getUser('user');
    const duration = interaction.options.getInteger('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = await interaction.guild.members.fetch(user);

    await member.timeout(duration * 60 * 1000, reason);
    const embed = new EmbedBuilder()
      .setTitle('User Muted')
      .setDescription(`**${user.tag}** muted for ${duration} minutes.\n**Reason:** ${reason}`)
      .setColor('#FF4500')
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });

    const modlogChannelId = client.settings.get(`${interaction.guild.id}:modlog`);
    if (modlogChannelId) {
      const modlogChannel = client.channels.cache.get(modlogChannelId);
      if (modlogChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('Mute Log')
          .setDescription(`**User:** ${user.tag}\n**Action:** Mute\n**Duration:** ${duration} min\n**Reason:** ${reason}\n**Moderator:** ${interaction.user.tag}`)
          .setColor('#FF4500')
          .setTimestamp();
        modlogChannel.send({ embeds: [logEmbed] });
      }
    }
  },
};