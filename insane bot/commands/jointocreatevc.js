const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jointocreatevc')
    .setDescription('Manage Join-to-Create voice channel triggers.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a Join-to-Create voice channel trigger.')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('The trigger voice channel')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('mode')
            .setDescription('The naming mode for channels created by this trigger')
            .setRequired(true)
            .addChoices(
              { name: 'User (e.g., "User\'s Channel")', value: 'user' },
              { name: 'Sequential (e.g., "Trigger 1, 2, 3")', value: 'sequential' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a Join-to-Create voice channel trigger.')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('The trigger voice channel to remove')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all current Join-to-Create trigger channels.')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-limit')
        .setDescription('Set the default user limit for a Join-to-Create trigger channel.')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('The trigger voice channel to modify')
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('limit')
            .setDescription('User limit (0-99, 0 = no limit)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(99)
        )
    ),
  category: 'Voice Channels',
  cooldown: 10,
  async execute(interaction, client) {
    try {
      await interaction.deferReply();

      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply({ content: 'You need Administrator permissions to manage Join-to-Create triggers!' });
      }
      if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.editReply({ content: 'I need Manage Channels permissions to create voice channels!' });
      }

      const subcommand = interaction.options.getSubcommand();
      let triggerChannels = client.settings.get(`${interaction.guild.id}:jointocreate`) || [];

      if (subcommand === 'add') {
        const channel = interaction.options.getChannel('channel');
        const mode = interaction.options.getString('mode');
        if (channel.type !== ChannelType.GuildVoice) {
          return interaction.editReply({ content: 'Please select a voice channel!' });
        }

        if (triggerChannels.some(tc => tc.channelId === channel.id)) {
          return interaction.editReply({ content: `${channel} is already a Join-to-Create trigger!` });
        }

        const memberCount = channel.members.size;
        triggerChannels.push({ channelId: channel.id, mode, userLimit: mode === 'sequential' ? 10 : 10 });
        client.settings.set(`${interaction.guild.id}:jointocreate`, triggerChannels);
        logger.info(`Added Join-to-Create trigger ${channel.name} (ID: ${channel.id}) with mode ${mode} for guild ${interaction.guild.id}. Current users: ${memberCount}`);

        const embed = new EmbedBuilder()
          .setTitle('Join-to-Create VC Added')
          .setDescription(
            `Added ${channel} as a Join-to-Create trigger with **${mode}** mode.\n` +
            `Join it to test!\nCurrent triggers: ${triggerChannels.map(tc => `<#${tc.channelId}> (${tc.mode}, limit: ${tc.userLimit})`).join(', ') || 'None'}`
          )
          .setColor('#00FF00')
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else if (subcommand === 'remove') {
        const channel = interaction.options.getChannel('channel');
        if (channel.type !== ChannelType.GuildVoice) {
          return interaction.editReply({ content: 'Please select a voice channel!' });
        }

        if (!triggerChannels.some(tc => tc.channelId === channel.id)) {
          return interaction.editReply({ content: `${channel} is not a Join-to-Create trigger!` });
        }

        const memberCount = channel.members.size;
        triggerChannels = triggerChannels.filter(tc => tc.channelId !== channel.id);
        client.settings.set(`${interaction.guild.id}:jointocreate`, triggerChannels);
        logger.info(`Removed Join-to-Create trigger ${channel.name} (ID: ${channel.id}) from guild ${interaction.guild.id}. Users before removal: ${memberCount}`);

        const embed = new EmbedBuilder()
          .setTitle('Join-to-Create VC Removed')
          .setDescription(
            `Removed ${channel} from Join-to-Create triggers.\n` +
            `Current triggers: ${triggerChannels.length ? triggerChannels.map(tc => `<#${tc.channelId}> (${tc.mode}, limit: ${tc.userLimit})`).join(', ') : 'None'}`
          )
          .setColor('#FF4444')
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else if (subcommand === 'list') {
        const embed = new EmbedBuilder()
          .setTitle('Join-to-Create VC Triggers')
          .setDescription(
            `Current triggers: ${triggerChannels.length ? triggerChannels.map(tc => `<#${tc.channelId}> (${tc.mode}, limit: ${tc.userLimit})`).join(', ') : 'None'}`
          )
          .setColor('#00FFFF')
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else if (subcommand === 'set-limit') {
        const channel = interaction.options.getChannel('channel');
        const newLimit = interaction.options.getInteger('limit');

        if (channel.type !== ChannelType.GuildVoice) {
          return interaction.editReply({ content: 'Please select a voice channel!' });
        }

        const triggerIndex = triggerChannels.findIndex(tc => tc.channelId === channel.id);
        if (triggerIndex === -1) {
          return interaction.editReply({ content: `${channel} is not a Join-to-Create trigger!` });
        }

        const memberCount = channel.members.size;
        const oldLimit = triggerChannels[triggerIndex].userLimit;
        triggerChannels[triggerIndex].userLimit = newLimit;
        client.settings.set(`${interaction.guild.id}:jointocreate`, triggerChannels);
        logger.info(`Set user limit for trigger ${channel.name} (ID: ${channel.id}) in guild ${interaction.guild.id} from ${oldLimit} to ${newLimit}. Current users: ${memberCount}`);

        const embed = new EmbedBuilder()
          .setTitle('Join-to-Create VC Limit Updated')
          .setDescription(
            `Updated user limit for ${channel} from ${oldLimit} to **${newLimit === 0 ? 'no limit' : newLimit}**.\n` +
            `Current triggers: ${triggerChannels.map(tc => `<#${tc.channelId}> (${tc.mode}, limit: ${tc.userLimit})`).join(', ') || 'None'}`
          )
          .setColor('#FFD700')
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      logger.error('Jointocreatevc command error:', error.message);
      if (!interaction.replied) {
        await interaction.editReply({ content: `Failed to manage Join-to-Create VC: ${error.message}` });
      } else {
        await interaction.followUp({ content: `Failed to manage Join-to-Create VC: ${error.message}`, ephemeral: true });
      }
    }
  },
};