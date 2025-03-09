const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionmenu')
    .setDescription('Create a reaction role menu')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel to send the reaction role menu to')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('title')
        .setDescription('Title for the reaction role menu')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('description')
        .setDescription('Description for the reaction role menu')
        .setRequired(true))
    .addBooleanOption(option =>
      option.setName('exclusive')
        .setDescription('Whether users can select only one role (true) or multiple roles (false)')
        .setRequired(false))
    .setDefaultMemberPermissions(0x0000000000000008), // ADMINISTRATOR permission

  async execute(interaction, client) {
    try {
      // Check permissions
      if (!interaction.member.permissions.has('Administrator')) {
        return await interaction.reply({
          content: '❌ You need Administrator permissions to use this command!',
          ephemeral: true
        });
      }

      // Get command options
      const channel = interaction.options.getChannel('channel');
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const exclusive = interaction.options.getBoolean('exclusive') ?? false;

      // Validate channel
      if (!channel) {
        return await interaction.reply({
          content: '❌ Please provide a valid channel!',
          ephemeral: true
        });
      }

      // Check if it's a text channel
      if (channel.type !== 0) { // 0 is GUILD_TEXT
        return await interaction.reply({
          content: '❌ Please select a text channel! Voice channels, categories, and other channel types are not supported.',
          ephemeral: true
        });
      }

      // Check if bot has permissions in the channel
      const botPermissions = channel.permissionsFor(interaction.guild.members.me);
      if (!botPermissions?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
        return await interaction.reply({
          content: '❌ I need permissions to view the channel, send messages, and embed links in the selected channel!',
          ephemeral: true
        });
      }

      // Initial reply
      await interaction.reply({
        content: 'Let\'s set up your reaction roles! Use the buttons below to add roles.',
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('add_role')
              .setLabel('Add Role')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('finish')
              .setLabel('Finish & Create')
              .setStyle(ButtonStyle.Success)
              .setDisabled(true)
          )
        ]
      });

      // Store setup data
      const setupData = {
        roles: [],
        channel,
        title,
        description,
        exclusive
      };

      // Create collector for the setup message
      const collector = interaction.channel.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 300000 // 5 minutes
      });

      collector.on('collect', async i => {
        try {
          if (i.customId === 'add_role') {
            if (setupData.roles.length >= 25) {
              await i.reply({
                content: '❌ You can only add up to 25 roles!',
                ephemeral: true
              });
              return;
            }

            // Create role select menu
            const roles = interaction.guild.roles.cache
              .filter(r => 
                r.id !== interaction.guild.id && 
                !r.managed && 
                r.position < interaction.guild.members.me.roles.highest.position
              )
              .map(r => ({
                label: r.name,
                value: r.id,
                description: `Add this role to the menu`
              }));

            if (roles.length === 0) {
              await i.reply({
                content: '❌ No available roles found! Make sure the bot\'s role is positioned above the roles you want to add.',
                ephemeral: true
              });
              return;
            }

            // Show role selection menu
            await i.reply({
              content: 'Select a role to add:',
              ephemeral: true,
              components: [
                new ActionRowBuilder().addComponents(
                  new StringSelectMenuBuilder()
                    .setCustomId('role_select')
                    .setPlaceholder('Select a role')
                    .addOptions(roles)
                )
              ]
            });
          }
          else if (i.customId === 'role_select') {
            const role = interaction.guild.roles.cache.get(i.values[0]);
            if (!role) {
              await i.reply({
                content: '❌ Role not found!',
                ephemeral: true
              });
              return;
            }

            // Show modal for role description
            const modal = new ModalBuilder()
              .setCustomId('role_description')
              .setTitle(`Add Role: ${role.name}`)
              .addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('Description')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Enter a description for this role')
                    .setRequired(true)
                    .setMaxLength(100)
                )
              );

            // Store the selected role temporarily
            setupData.tempRole = {
              id: role.id,
              name: role.name
            };

            await i.showModal(modal);
          }
          else if (i.customId === 'role_description') {
            const description = i.fields.getTextInputValue('description');
            
            // Add role to the list
            setupData.roles.push({
              ...setupData.tempRole,
              description
            });
            delete setupData.tempRole;

            // Update the setup message
            const roleList = setupData.roles.map((r, index) => 
              `${index + 1}. **${r.name}** - ${r.description}`
            ).join('\n');

            await i.update({
              content: `Roles added:\n${roleList}\n\nUse the buttons below to continue:`,
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId('add_role')
                    .setLabel('Add Role')
                    .setStyle(ButtonStyle.Primary),
                  new ButtonBuilder()
                    .setCustomId('finish')
                    .setLabel('Finish & Create')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(false)
                )
              ]
            });
          }
          else if (i.customId === 'finish') {
            if (setupData.roles.length === 0) {
              await i.reply({
                content: '❌ Please add at least one role!',
                ephemeral: true
              });
              return;
            }

            // Create the role menu embed
            const embed = new EmbedBuilder()
              .setTitle(setupData.title)
              .setDescription(setupData.description)
              .addFields({
                name: '📋 Available Roles',
                value: setupData.roles.map(r => 
                  `**${r.name}**\n┗ ${r.description}`
                ).join('\n\n')
              })
              .addFields({
                name: '📝 Instructions',
                value: setupData.exclusive 
                  ? '• Select one role from the menu below\n• Your previous role will be removed when selecting a new one'
                  : '• Select roles from the menu below\n• Select a role again to remove it'
              })
              .setColor('#00ff00')
              .setTimestamp()
              .setFooter({
                text: `Created by ${interaction.user.tag} • ${setupData.exclusive ? 'Single Choice' : 'Multiple Choice'}`,
                iconURL: interaction.user.displayAvatarURL()
              });

            // Create the role select menu
            const menu = new StringSelectMenuBuilder()
              .setCustomId(`roles_${interaction.guild.id}_${Date.now()}`)
              .setPlaceholder('Select role(s)')
              .setMinValues(0)
              .setMaxValues(setupData.exclusive ? 1 : setupData.roles.length)
              .addOptions(
                setupData.roles.map(r => ({
                  label: r.name,
                  value: r.id,
                  description: r.description.substring(0, 100),
                  emoji: '🎭'
                }))
              );

            // Send the menu to the specified channel
            const message = await setupData.channel.send({
              embeds: [embed],
              components: [new ActionRowBuilder().addComponents(menu)]
            });

            // Save menu configuration
            const menuConfig = {
              messageId: message.id,
              channelId: message.channel.id,
              guildId: message.guild.id,
              roles: setupData.roles,
              exclusive: setupData.exclusive
            };

            // Save to database
            const guildMenus = client.settings.get(`${interaction.guild.id}:reactionroles`) || {};
            guildMenus[message.id] = menuConfig;
            client.settings.set(`${interaction.guild.id}:reactionroles`, guildMenus);

            if (client.saveSettings) {
              await client.saveSettings();
              logger.info(`Saved reaction menu for guild ${interaction.guild.id}`);
            }

            // End the setup
            await i.update({
              content: `✅ Reaction role menu created in ${setupData.channel}!\n[Click here to view it](${message.url})`,
              components: []
            });

            collector.stop('finished');
          }
        } catch (error) {
          logger.error('Error in reaction menu setup:', error);
          await i.reply({
            content: '❌ An error occurred. Please try again.',
            ephemeral: true
          }).catch(() => {});
        }
      });

      collector.on('end', (collected, reason) => {
        if (reason !== 'finished') {
          interaction.editReply({
            content: '⏰ Setup timed out or was cancelled. Please run the command again.',
            components: []
          }).catch(() => {});
        }
      });

    } catch (error) {
      logger.error('Error in reactionmenu command:', error);
      await interaction.reply({
        content: '❌ An error occurred while setting up the reaction menu. Please try again.',
        ephemeral: true
      }).catch(() => {});
    }
  }
}; 