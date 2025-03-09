const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Create beautiful embedded messages')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new embed message')
        .addStringOption(option =>
          option.setName('template')
            .setDescription('Start with a template')
            .setRequired(false)
            .addChoices(
              { name: 'Announcement', value: 'announcement' },
              { name: 'Rules', value: 'rules' },
              { name: 'Welcome', value: 'welcome' },
              { name: 'Info', value: 'info' }
            )))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit an existing embed message')
        .addStringOption(option =>
          option.setName('message_id')
            .setDescription('ID of the message to edit')
            .setRequired(true))),

  cooldown: 3,

  async execute(interaction, client) {
    try {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'create') {
        const template = interaction.options.getString('template');
        await this.handleCreate(interaction, client, template);
      } else if (subcommand === 'edit') {
        const messageId = interaction.options.getString('message_id');
        await this.handleEdit(interaction, client, messageId);
      }
    } catch (error) {
      logger.error('Error in embed command:', error);
      await interaction.reply({
        content: 'There was an error with the embed command. Please try again.',
        ephemeral: true
      });
    }
  },

  async handleCreate(interaction, client, template) {
    // Create initial embed based on template
    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTimestamp();

    if (template) {
      switch (template) {
        case 'announcement':
          embed
            .setTitle('📢 New Announcement')
            .setDescription('Important server announcement...')
            .addFields(
              { name: 'What', value: 'Details of the announcement...', inline: true },
              { name: 'When', value: 'Timeline...', inline: true }
            );
          break;
        case 'rules':
          embed
            .setTitle('📜 Server Rules')
            .setDescription('Please follow these rules to keep our server friendly and safe.')
            .addFields(
              { name: '1. Be Respectful', value: 'Treat everyone with respect...', inline: false },
              { name: '2. No Spam', value: 'Avoid excessive messages...', inline: false }
            );
          break;
        case 'welcome':
          embed
            .setTitle('👋 Welcome to the Server!')
            .setDescription('We\'re glad to have you here.')
            .addFields(
              { name: '📚 Getting Started', value: 'Check out our channels...', inline: true },
              { name: '🎮 Have Fun!', value: 'Enjoy your stay...', inline: true }
            );
          break;
        case 'info':
          embed
            .setTitle('ℹ️ Server Information')
            .setDescription('Everything you need to know about our server.')
            .addFields(
              { name: 'About Us', value: 'Server description...', inline: false },
              { name: 'Features', value: 'What we offer...', inline: false }
            );
          break;
      }
    } else {
      embed
        .setTitle('New Embed')
        .setDescription('Click the buttons below to customize this embed.');
    }

    // Create editor buttons
    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('embed_title')
          .setLabel('Edit Title')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📝'),
        new ButtonBuilder()
          .setCustomId('embed_description')
          .setLabel('Edit Description')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📄'),
        new ButtonBuilder()
          .setCustomId('embed_color')
          .setLabel('Change Color')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🎨'),
        new ButtonBuilder()
          .setCustomId('embed_field')
          .setLabel('Add Field')
          .setStyle(ButtonStyle.Success)
          .setEmoji('➕'),
        new ButtonBuilder()
          .setCustomId('embed_send')
          .setLabel('Send')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅')
      );

    const response = await interaction.reply({
      content: 'Customize your embed:',
      embeds: [embed],
      components: [buttons],
      ephemeral: true
    });

    // Create button collector
    const collector = response.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time: 300000 // 5 minutes
    });

    collector.on('collect', async i => {
      try {
        switch (i.customId) {
          case 'embed_title':
            await this.showTitleModal(i);
            break;
          case 'embed_description':
            await this.showDescriptionModal(i);
            break;
          case 'embed_color':
            await this.showColorModal(i);
            break;
          case 'embed_field':
            await this.showFieldModal(i);
            break;
          case 'embed_send':
            await this.sendEmbed(i);
            collector.stop();
            break;
        }
      } catch (error) {
        logger.error('Error handling embed button:', error);
        await i.reply({
          content: 'There was an error processing your request. Please try again.',
          ephemeral: true
        });
      }
    });

    collector.on('end', () => {
      interaction.editReply({
        components: []
      }).catch(() => {});
    });
  },

  async showTitleModal(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('embed_title_modal')
      .setTitle('Edit Embed Title');

    const titleInput = new TextInputBuilder()
      .setCustomId('title_input')
      .setLabel('Title')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(256)
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(titleInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  },

  async showDescriptionModal(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('embed_description_modal')
      .setTitle('Edit Embed Description');

    const descInput = new TextInputBuilder()
      .setCustomId('description_input')
      .setLabel('Description')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(4000)
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(descInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  },

  async showColorModal(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('embed_color_modal')
      .setTitle('Change Embed Color');

    const colorInput = new TextInputBuilder()
      .setCustomId('color_input')
      .setLabel('Color (Hex code e.g., #FF0000)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(7)
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(colorInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  },

  async showFieldModal(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('embed_field_modal')
      .setTitle('Add Embed Field');

    const nameInput = new TextInputBuilder()
      .setCustomId('field_name')
      .setLabel('Field Name')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(256)
      .setRequired(true);

    const valueInput = new TextInputBuilder()
      .setCustomId('field_value')
      .setLabel('Field Value')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1024)
      .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(nameInput);
    const row2 = new ActionRowBuilder().addComponents(valueInput);
    modal.addComponents(row1, row2);

    await interaction.showModal(modal);
  },

  async sendEmbed(interaction) {
    const message = interaction.message;
    const embed = message.embeds[0];

    await interaction.channel.send({ embeds: [embed] });
    await interaction.update({
      content: 'Embed sent successfully!',
      components: []
    });
  },

  async handleEdit(interaction, client, messageId) {
    try {
      const message = await interaction.channel.messages.fetch(messageId);
      if (!message.embeds.length) {
        return await interaction.reply({
          content: 'That message doesn\'t contain any embeds to edit.',
          ephemeral: true
        });
      }

      // Create editor with existing embed
      await this.handleCreate(interaction, client, null, message.embeds[0]);
    } catch (error) {
      logger.error('Error editing embed:', error);
      await interaction.reply({
        content: 'There was an error editing the embed. Make sure the message ID is valid and the message is in this channel.',
        ephemeral: true
      });
    }
  }
}; 