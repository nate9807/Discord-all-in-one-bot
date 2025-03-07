const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionroles')
    .setDescription('Create a reaction role message with a dropdown menu.')
    // Required options (4 total)
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to send the reaction role message to')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText))
    .addStringOption(option =>
      option.setName('title')
        .setDescription('Title of the reaction role embed')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('description')
        .setDescription('Description of the reaction role embed')
        .setRequired(true))
    .addRoleOption(option =>
      option.setName('role1')
        .setDescription('First role to include in the dropdown')
        .setRequired(true))
    // Optional options (20 total, bringing total to 24)
    .addStringOption(option =>
      option.setName('color')
        .setDescription('Embed color in hex (e.g., #FF0000) (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role2')
        .setDescription('Second role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role3')
        .setDescription('Third role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role4')
        .setDescription('Fourth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role5')
        .setDescription('Fifth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role6')
        .setDescription('Sixth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role7')
        .setDescription('Seventh role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role8')
        .setDescription('Eighth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role9')
        .setDescription('Ninth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role10')
        .setDescription('Tenth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role11')
        .setDescription('Eleventh role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role12')
        .setDescription('Twelfth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role13')
        .setDescription('Thirteenth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role14')
        .setDescription('Fourteenth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role15')
        .setDescription('Fifteenth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role16')
        .setDescription('Sixteenth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role17')
        .setDescription('Seventeenth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role18')
        .setDescription('Eighteenth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role19')
        .setDescription('Nineteenth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role20')
        .setDescription('Twentieth role to include in the dropdown (optional)')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('role21')
        .setDescription('Twenty-first role to include in the dropdown (optional)')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  cooldown: 10,

  async execute(interaction, client) {
    // Check permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ 
        content: 'You need Administrator permissions to use this command!', 
        ephemeral: true 
      });
    }

    // Get options
    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');
    const color = interaction.options.getString('color');

    // Collect selected roles (up to 21)
    const roles = [];
    for (let i = 1; i <= 21; i++) {
      const role = interaction.options.getRole(`role${i}`);
      if (role) roles.push(role);
    }

    // Validate bot permissions in channel
    const botMember = interaction.guild.members.me;
    if (!channel.permissionsFor(botMember).has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) {
      return interaction.reply({ 
        content: `I don't have permission to send messages in ${channel}!`, 
        ephemeral: true 
      });
    }

    // Validate roles
    if (roles.length === 0) {
      return interaction.reply({ content: 'You must specify at least one role!', ephemeral: true });
    }

    // Filter roles to ensure they're editable and not managed
    const validRoles = roles.filter(role => 
      role.editable && !role.managed && role.id !== interaction.guild.id
    );

    if (validRoles.length === 0) {
      return interaction.reply({ content: 'None of the specified roles are editable by me!', ephemeral: true });
    }

    // Defer reply since this might take a while
    await interaction.deferReply({ ephemeral: true });

    // Build role selection menu
    const roleOptions = validRoles.slice(0, 25).map(role => ({
      label: role.name,
      value: role.id,
      description: `Select to assign ${role.name}`,
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('reaction_role_select')
      .setPlaceholder('Select your roles...')
      .setMinValues(0)
      .setMaxValues(roleOptions.length)
      .addOptions(roleOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    // Build the embed
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color && /^#[0-9A-F]{6}$/i.test(color) ? color : '#00FF00')
      .setTimestamp()
      .setFooter({ 
        text: `Created by ${interaction.user.tag}`, 
        iconURL: interaction.user.displayAvatarURL() 
      });

    try {
      // Send the reaction role message
      const message = await channel.send({ 
        embeds: [embed], 
        components: [row] 
      });

      // Save to reactionmessages.json
      const reactionMessagesPath = path.join(__dirname, '..', 'data', 'reactionmessages.json');
      let reactionMessages = {};
      try {
        const data = await fs.readFile(reactionMessagesPath, 'utf8');
        reactionMessages = JSON.parse(data);
      } catch (err) {
        // File doesn't exist yet, we'll create it
      }

      reactionMessages[message.id] = {
        guildId: interaction.guild.id,
        channelId: channel.id,
        roles: Object.fromEntries(validRoles.map(role => [role.id, role.name])),
      };

      await fs.writeFile(reactionMessagesPath, JSON.stringify(reactionMessages, null, 2));
      logger.info(`Saved reaction role message ${message.id} to reactionmessages.json`);

      // Success reply
      const successEmbed = new EmbedBuilder()
        .setDescription(`Reaction role message sent to ${channel}! [View it here](${message.url})`)
        .setColor('#00FF00')
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
    } catch (error) {
      logger.error(`Failed to create reaction role message: ${error}`);
      await interaction.editReply({ 
        content: 'Failed to create the reaction role message. Please check my permissions and try again.', 
      });
    }
  },

  async initialize(client) {
    const reactionMessagesPath = path.join(__dirname, '..', 'data', 'reactionmessages.json');
    let reactionMessages = {};

    try {
      const data = await fs.readFile(reactionMessagesPath, 'utf8');
      reactionMessages = JSON.parse(data);
    } catch (err) {
      logger.info('No reactionmessages.json found, starting fresh.');
      return;
    }

    client.on('interactionCreate', async interaction => {
      if (!interaction.isStringSelectMenu() || interaction.customId !== 'reaction_role_select') return;

      const messageId = interaction.message.id;
      const config = reactionMessages[messageId];
      if (!config) return;

      const guild = client.guilds.cache.get(config.guildId);
      if (!guild) return;

      const member = guild.members.cache.get(interaction.user.id);
      if (!member) return;

      await interaction.deferReply({ ephemeral: true });

      try {
        const availableRoles = new Set(Object.keys(config.roles));
        const selectedRoles = interaction.values;
        const currentRoles = member.roles.cache;

        const rolesToAdd = selectedRoles.filter(id => availableRoles.has(id) && !currentRoles.has(id));
        const rolesToRemove = [...availableRoles].filter(id => !selectedRoles.includes(id) && currentRoles.has(id));

        if (rolesToAdd.length > 0) {
          await member.roles.add(rolesToAdd);
        }
        if (rolesToRemove.length > 0) {
          await member.roles.remove(rolesToRemove);
        }

        const responseEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setDescription(
            `${rolesToAdd.length > 0 ? `Added roles: ${rolesToAdd.map(id => config.roles[id]).join(', ')}\n` : ''}` +
            `${rolesToRemove.length > 0 ? `Removed roles: ${rolesToRemove.map(id => config.roles[id]).join(', ')}` : ''}` ||
            'No role changes made.'
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [responseEmbed] });
      } catch (error) {
        logger.error(`Failed to update roles for ${interaction.user.tag}: ${error}`);
        await interaction.editReply({ 
          content: 'Failed to update your roles. Please try again or contact an administrator.', 
        });
      }
    });

    logger.info('Reaction roles initialized and loaded from reactionmessages.json');
  },
};