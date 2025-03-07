const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Set an auto-role for new members.')
    .addRoleOption(option => 
      option.setName('role')
        .setDescription('The role to assign to new members')
        .setRequired(true)
    ),
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();

    // Check permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.editReply({ content: 'You need Manage Roles permissions to set an auto-role!', ephemeral: true });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.editReply({ content: 'I need Manage Roles permissions to assign roles!', ephemeral: true });
    }

    const role = interaction.options.getRole('role');

    // Validate role hierarchy (bot's role must be above the target role)
    const botMember = interaction.guild.members.me;
    if (role.position >= botMember.roles.highest.position) {
      return interaction.editReply({ 
        content: `I can’t assign **${role.name}** because it’s above my highest role! Please move my role above it.`, 
        ephemeral: true 
      });
    }

    try {
      // Store the auto-role setting
      client.settings.set(`${interaction.guild.id}:autorole`, role.id);

      const embed = new EmbedBuilder()
        .setTitle('Auto-Role Set')
        .setDescription(`New members will automatically receive **${role.name}**.`)
        .setColor('#00FF00')
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(`Failed to set autorole for guild ${interaction.guild.id}: ${error.message}`);
      await interaction.editReply({ 
        content: 'Failed to set the auto-role. Please try again later.', 
        ephemeral: true 
      });
    }
  },

  // Function to initialize the autorole listener (call this in your main bot file)
  initialize(client) {
    client.on('guildMemberAdd', async (member) => {
      const guild = member.guild;
      const autoroleId = client.settings.get(`${guild.id}:autorole`);
      if (!autoroleId) return;

      try {
        const role = guild.roles.cache.get(autoroleId);
        if (!role) {
          console.warn(`Autorole ${autoroleId} not found in guild ${guild.id}`);
          return;
        }

        // Check if the bot still has permission and hierarchy to assign the role
        const botMember = guild.members.me;
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
          console.warn(`Bot lacks Manage Roles permission in guild ${guild.id}`);
          return;
        }
        if (role.position >= botMember.roles.highest.position) {
          console.warn(`Bot's role is below ${role.name} in guild ${guild.id}`);
          return;
        }

        await member.roles.add(role);
        console.log(`Assigned role ${role.name} to ${member.user.tag} in guild ${guild.id}`);
      } catch (error) {
        console.error(`Failed to assign autorole to ${member.user.tag} in guild ${guild.id}: ${error.message}`);
      }
    });
  }
};