const { 
  EmbedBuilder, 
  PermissionFlagsBits, 
  ChannelType, 
  ButtonBuilder, 
  ButtonStyle, 
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder} = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');

const logger = require('../utils/logger');

// Store created channels in client settings instead of memory
const getCreatedChannels = (client, guildId) => {
  const key = `${guildId}:jtc_channels`;
  const data = client.settings.get(key) || {};
  return new Map(Object.entries(data));
};

const saveCreatedChannels = (client, guildId, channels) => {
  const key = `${guildId}:jtc_channels`;
  const data = Object.fromEntries(channels);
  client.settings.set(key, data);
  // Force save to file
  if (client.saveSettings && typeof client.saveSettings === 'function') {
    client.saveSettings();
  }
};

const getChannelLimit = (client, channelId) => {
  const key = `vc:${channelId}:limit`;
  return client.settings.get(key);
};

const setChannelLimit = (client, channelId, limit) => {
  const key = `vc:${channelId}:limit`;
  client.settings.set(key, limit);
};

// Create control panel message
const createControlPanel = async (textChannel, member) => {
  const embed = new EmbedBuilder()
    .setTitle('🎙️ Voice Channel Controls')
    .setDescription('Manage your personal voice channel with style!')
    .setColor('#00BFFF')
    .setThumbnail(textChannel.client.user.displayAvatarURL())
    .addFields(
      {
        name: '🔧 General Controls',
        value: '🔒 **Lock Channel**: Prevent others from joining\n🔓 **Unlock Channel**: Allow others to join\n📛 **Rename Channel**: Change the channel name\n👥 **Set User Limit**: Set maximum users (0-99)\n🎚️ **Set Bitrate**: Adjust audio quality (8-96kbps)',
        inline: true,
      },
      {
        name: '✨ Extra Features',
        value: '👤 **Invite User**: Add a specific user\n🎮 **Activity Mode**: Enable Discord Activities',
        inline: true,
      },
      {
        name: '🛡️ Moderation (Admin Only)',
        value: '🔇 **Mute All**: Mute all users\n🔊 **Unmute All**: Unmute all users\n👢 **Kick User**: Kick and ban a user from rejoining\n👁️ **Hide Channel**: Toggle visibility for @everyone\n🗑️ **Delete Channel**: Remove the channel',
        inline: false,
      }
    )
    .setFooter({ text: `Owner: ${member.displayName} | Powered by Bot Boi`, iconURL: member.displayAvatarURL() })
    .setTimestamp();

  const buttons = [
    new ButtonBuilder().setCustomId('vc_lock').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_unlock').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_name').setEmoji('📛').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_limit').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_bitrate').setEmoji('🎚️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_invite').setEmoji('👤').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_activity').setEmoji('🎮').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_muteall').setEmoji('🔇').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_unmuteall').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_kick').setEmoji('👢').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_hide').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vc_delete').setEmoji('🗑️').setStyle(ButtonStyle.Secondary),
  ];

  const actionRows = [];
  for (let i = 0; i < buttons.length; i += 4) {
    const row = new ActionRowBuilder().addComponents(buttons.slice(i, i + 4));
    actionRows.push(row);
  }

  return await textChannel.send({ embeds: [embed], components: actionRows });
};

// Handle button interactions - moved outside the event handler
const handleVoiceChannelInteraction = async (interaction, client) => {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;
  
  const guild = interaction.guild;
  const guildId = guild.id;
  
  // Get created channels from settings
  const createdChannels = getCreatedChannels(client, guildId);
  
  // For modal submissions, we need to check if the user is in a voice channel
  if (!interaction.member?.voice?.channel) {
    if (interaction.isButton()) {
      await interaction.reply({ 
        embeds: [new EmbedBuilder().setDescription('❌ You must be in a voice channel to use this button!').setColor('#FF0000')], 
        ephemeral: true 
      });
    } else if (interaction.isModalSubmit()) {
      await interaction.reply({ 
        embeds: [new EmbedBuilder().setDescription('❌ You must stay in a voice channel while using this feature!').setColor('#FF0000')], 
        ephemeral: true 
      });
    }
    return;
  }
  
  const channelData = createdChannels.get(interaction.member.voice.channelId);
  
  // Only process interactions for JTC channels or if the customId starts with vc_
  if (!channelData && !interaction.customId.startsWith('vc_') && !interaction.customId.includes('_modal')) {
    return;
  }

  try {
    switch (interaction.customId) {
      case 'vc_limit':
        const modal = new ModalBuilder()
          .setCustomId('limit_modal')
          .setTitle('Set User Limit');

        const limitInput = new TextInputBuilder()
          .setCustomId('limit_input')
          .setLabel('Enter user limit (0 for unlimited)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(2);

        const actionRow = new ActionRowBuilder().addComponents(limitInput);
        modal.addComponents(actionRow);

        await interaction.showModal(modal);
        break;

      case 'limit_modal':
        if (!interaction.isModalSubmit()) return;
        const limit = parseInt(interaction.fields.getTextInputValue('limit_input'));

        if (isNaN(limit) || limit < 0 || limit > 99) {
          await interaction.reply({ content: 'Please enter a valid number between 0 and 99.', ephemeral: true });
          return;
        }

        const voiceChannel = interaction.member.voice.channel;
        await voiceChannel.setUserLimit(limit);
        setChannelLimit(client, voiceChannel.id, limit);
        await interaction.reply({ 
          embeds: [new EmbedBuilder().setDescription(`✅ Limit set to **${limit === 0 ? 'no limit' : `${limit} users`}**!`).setColor('#00FF00')], 
          ephemeral: true 
        });
        break;

      case 'vc_lock':
        try {
          // Get the voice channel
          const voiceChannel = interaction.member.voice.channel;
          if (!voiceChannel) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ You must be in a voice channel to use this button!').setColor('#FF0000')], 
              ephemeral: true 
            });
            return;
          }
          
          // Check if user has permission
          if (channelData && channelData.ownerId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ Only the channel owner or an administrator can lock this channel!').setColor('#FF0000')], 
              ephemeral: true 
            });
            return;
          }
          
          // Lock the channel
          await voiceChannel.permissionOverwrites.edit(guild.id, {
            Connect: false
          });
          
          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription('🔒 Channel locked! No new users can join.').setColor('#FF4500')], 
            ephemeral: true 
          });
        } catch (error) {
          logger.error(`Error locking channel: ${error.message}`);
          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription(`❌ Failed to lock channel: ${error.message}`).setColor('#FF0000')], 
            ephemeral: true 
          });
        }
        break;

      case 'vc_unlock':
        try {
          // Get the voice channel
          const voiceChannel = interaction.member.voice.channel;
          if (!voiceChannel) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ You must be in a voice channel to use this button!').setColor('#FF0000')], 
              ephemeral: true 
            });
            return;
          }
          
          // Check if user has permission
          if (channelData && channelData.ownerId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ Only the channel owner or an administrator can unlock this channel!').setColor('#FF0000')], 
              ephemeral: true 
            });
            return;
          }
          
          // Unlock the channel
          await voiceChannel.permissionOverwrites.edit(guild.id, {
            Connect: null // Remove the override
          });
          
          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription('🔓 Channel unlocked! Anyone can join now.').setColor('#00FF00')], 
            ephemeral: true 
          });
        } catch (error) {
          logger.error(`Error unlocking channel: ${error.message}`);
          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription(`❌ Failed to unlock channel: ${error.message}`).setColor('#FF0000')], 
            ephemeral: true 
          });
        }
        break;

      case 'vc_name':
        const nameModal = new ModalBuilder()
          .setCustomId('name_modal')
          .setTitle('Rename Channel');

        const nameInput = new TextInputBuilder()
          .setCustomId('name_input')
          .setLabel('Enter new channel name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(32);

        const nameRow = new ActionRowBuilder().addComponents(nameInput);
        nameModal.addComponents(nameRow);

        await interaction.showModal(nameModal);
        break;

      case 'name_modal':
        if (!interaction.isModalSubmit()) return;
        const newName = interaction.fields.getTextInputValue('name_input');
        await interaction.member.voice.channel.setName(newName);
        await interaction.reply({ 
          embeds: [new EmbedBuilder().setDescription(`✅ Renamed to **${newName}**!`).setColor('#00FF00')], 
          ephemeral: true 
        });
        break;

      case 'vc_bitrate':
        const bitrateModal = new ModalBuilder()
          .setCustomId('bitrate_modal')
          .setTitle('Set Bitrate');

        const bitrateInput = new TextInputBuilder()
          .setCustomId('bitrate_input')
          .setLabel('Enter bitrate (8-96 kbps)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(2);

        const bitrateRow = new ActionRowBuilder().addComponents(bitrateInput);
        bitrateModal.addComponents(bitrateRow);

        await interaction.showModal(bitrateModal);
        break;

      case 'bitrate_modal':
        if (!interaction.isModalSubmit()) return;
        const bitrate = Math.min(96, Math.max(8, parseInt(interaction.fields.getTextInputValue('bitrate_input')) || 8)) * 1000;
        await interaction.member.voice.channel.setBitrate(bitrate);
        await interaction.reply({ 
          embeds: [new EmbedBuilder().setDescription(`✅ Bitrate set to **${bitrate/1000}kbps**!`).setColor('#00FF00')], 
          ephemeral: true 
        });
        break;

      case 'vc_invite':
        const inviteModal = new ModalBuilder()
          .setCustomId('invite_modal')
          .setTitle('Invite User');

        const inviteInput = new TextInputBuilder()
          .setCustomId('invite_input')
          .setLabel('User Mention or ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(32);

        const inviteRow = new ActionRowBuilder().addComponents(inviteInput);
        inviteModal.addComponents(inviteRow);

        await interaction.showModal(inviteModal);
        break;

      case 'invite_modal':
        if (!interaction.isModalSubmit()) return;
        
        try {
          const input = interaction.fields.getTextInputValue('invite_input');
          
          // Clean up the input to handle different formats
          const userId = input.replace(/[<>@!]/g, '').trim();
          
          // First try to get from cache
          let target = guild.members.cache.get(userId);
          
          // If not in cache, try to fetch
          if (!target) {
            try {
              target = await guild.members.fetch(userId);
            } catch (fetchError) {
              logger.error(`Failed to fetch member ${userId}: ${fetchError.message}`);
              // Continue to the next step, we'll handle the null target there
            }
          }
          
          // If still no target, check if it's a mention
          if (!target && interaction.mentions && interaction.mentions.members) {
            target = interaction.mentions.members.first();
          }
          
          // If we still don't have a target, report error
          if (!target) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ User not found! Please use a valid user ID or mention.').setColor('#FF4500')], 
              ephemeral: true 
            });
            return;
          }

          // Get the voice channel
          const voiceChannel = interaction.member.voice.channel;
          if (!voiceChannel) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ You must be in a voice channel to invite users!').setColor('#FF0000')], 
              ephemeral: true 
            });
            return;
          }
          
          // Add permissions
          await voiceChannel.permissionOverwrites.edit(target.id, {
            Connect: true,
            ViewChannel: true
          });

          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription(`✅ Invited **${target.displayName}**!`).setColor('#00FF00')], 
            ephemeral: true 
          });
        } catch (error) {
          logger.error(`Error inviting user: ${error.message}`);
          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription(`❌ Failed to invite user: ${error.message}`).setColor('#FF0000')], 
            ephemeral: true 
          });
        }
        break;

      case 'vc_activity':
        await interaction.member.voice.channel.setRTCRegion('us-east');
        await interaction.reply({ 
          embeds: [new EmbedBuilder().setDescription('🎮 Activity mode enabled!\nStart an activity from the voice channel menu.').setColor('#00FF00')], 
          ephemeral: true 
        });
        break;

      case 'vc_muteall':
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription('❌ You need Administrator permissions to use this button!').setColor('#FF0000')], 
            ephemeral: true 
          });
          return;
        }

        for (const [, member] of interaction.member.voice.channel.members) {
          if (member.id !== interaction.member.id) {
            await member.voice.setMute(true).catch(() => {});
          }
        }

        await interaction.reply({ 
          embeds: [new EmbedBuilder().setDescription('🔇 All users muted!').setColor('#FF4500')], 
          ephemeral: true 
        });
        break;

      case 'vc_unmuteall':
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription('❌ You need Administrator permissions to use this button!').setColor('#FF0000')], 
            ephemeral: true 
          });
          return;
        }

        for (const [, member] of interaction.member.voice.channel.members) {
          await member.voice.setMute(false).catch(() => {});
        }

        await interaction.reply({ 
          embeds: [new EmbedBuilder().setDescription('🔊 All users unmuted!').setColor('#00FF00')], 
          ephemeral: true 
        });
        break;

      case 'vc_kick':
        const kickModal = new ModalBuilder()
          .setCustomId('kick_modal')
          .setTitle('Kick User');

        const kickInput = new TextInputBuilder()
          .setCustomId('kick_input')
          .setLabel('User Mention or ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(32);

        const kickRow = new ActionRowBuilder().addComponents(kickInput);
        kickModal.addComponents(kickRow);

        await interaction.showModal(kickModal);
        break;

      case 'kick_modal':
        if (!interaction.isModalSubmit()) return;
        
        try {
          const input = interaction.fields.getTextInputValue('kick_input');
          
          // Clean up the input to handle different formats
          const userId = input.replace(/[<>@!]/g, '').trim();
          
          // First try to get from cache
          let kickTarget = guild.members.cache.get(userId);
          
          // If not in cache, try to fetch
          if (!kickTarget) {
            try {
              kickTarget = await guild.members.fetch(userId);
            } catch (fetchError) {
              logger.error(`Failed to fetch member ${userId}: ${fetchError.message}`);
              // Continue to the next step, we'll handle the null target there
            }
          }
          
          // If still no target, check if it's a mention
          if (!kickTarget && interaction.mentions && interaction.mentions.members) {
            kickTarget = interaction.mentions.members.first();
          }
          
          // If we still don't have a target, report error
          if (!kickTarget) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ User not found! Please use a valid user ID or mention.').setColor('#FF4500')], 
              ephemeral: true 
            });
            return;
          }

          // Get the voice channel
          const voiceChannel = interaction.member.voice.channel;
          if (!voiceChannel) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ You must be in a voice channel to kick users!').setColor('#FF0000')], 
              ephemeral: true 
            });
            return;
          }
          
          // Check if user has permission
          if (channelData && kickTarget.id === channelData.ownerId && 
              !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ You cannot kick the channel owner!').setColor('#FF4500')], 
              ephemeral: true 
            });
            return;
          }

          // Disconnect if in channel
          if (voiceChannel.members.has(kickTarget.id)) {
            await kickTarget.voice.disconnect().catch(e => {
              logger.error(`Failed to disconnect user: ${e.message}`);
            });
          }

          // Ban from rejoining
          await voiceChannel.permissionOverwrites.edit(kickTarget.id, {
            Connect: false,
            ViewChannel: false
          });

          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription(`👢 Kicked **${kickTarget.displayName}** and banned from rejoining!`).setColor('#FF4500')], 
            ephemeral: true 
          });
        } catch (error) {
          logger.error(`Error kicking user: ${error.message}`);
          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription(`❌ Failed to kick user: ${error.message}`).setColor('#FF0000')], 
            ephemeral: true 
          });
        }
        break;

      case 'vc_hide':
        try {
          // Get the voice channel
          const voiceChannel = interaction.member.voice.channel;
          if (!voiceChannel) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ You must be in a voice channel to use this button!').setColor('#FF0000')], 
              ephemeral: true 
            });
            return;
          }
          
          // Check if user has permission
          if (channelData && channelData.ownerId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ Only the channel owner or an administrator can change visibility!').setColor('#FF0000')], 
              ephemeral: true 
            });
            return;
          }
          
          // Check current visibility
          const everyonePerms = voiceChannel.permissionOverwrites.cache.get(guild.id);
          const currentlyHidden = everyonePerms && everyonePerms.deny.has(PermissionFlagsBits.ViewChannel);
          
          // Toggle visibility
          await voiceChannel.permissionOverwrites.edit(guild.id, {
            ViewChannel: currentlyHidden ? null : false
          });
          
          await interaction.reply({ 
            embeds: [new EmbedBuilder()
              .setDescription(currentlyHidden ? '👁️ Channel is now visible to everyone!' : '👁️ Channel is now hidden from everyone!')
              .setColor(currentlyHidden ? '#00FF00' : '#FF4500')], 
            ephemeral: true 
          });
        } catch (error) {
          logger.error(`Error toggling channel visibility: ${error.message}`);
          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription(`❌ Failed to change visibility: ${error.message}`).setColor('#FF0000')], 
            ephemeral: true 
          });
        }
        break;

      case 'vc_delete':
        try {
          // Get the voice channel
          const voiceChannel = interaction.member.voice.channel;
          if (!voiceChannel) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ You must be in a voice channel to use this button!').setColor('#FF0000')], 
              ephemeral: true 
            });
            return;
          }
          
          // Check if user has permission
          if (channelData && channelData.ownerId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription('❌ Only the channel owner or an administrator can delete this channel!').setColor('#FF0000')], 
              ephemeral: true 
            });
            return;
          }
          
          // Send confirmation before deleting
          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription('🗑️ Deleting channel and associated text channel...').setColor('#FF4500')], 
            ephemeral: true 
          });
          
          // Get the text channel ID from channel data
          const textChannelId = channelData?.textChannelId;
          
          // Delete the voice channel
          await voiceChannel.delete().catch(e => {
            logger.error(`Failed to delete voice channel: ${e.message}`);
          });
          
          // Delete the text channel if it exists
          if (textChannelId) {
            const textChannel = guild.channels.cache.get(textChannelId);
            if (textChannel) {
              await textChannel.delete().catch(e => {
                logger.error(`Failed to delete text channel: ${e.message}`);
              });
            }
          }
          
          // Remove from tracking
          if (channelData) {
            createdChannels.delete(voiceChannel.id);
            saveCreatedChannels(client, guildId, createdChannels);
            logger.info(`Deleted JTC channel ${voiceChannel.name} and removed from tracking`);
          }
        } catch (error) {
          logger.error(`Error deleting channel: ${error.message}`);
          await interaction.reply({ 
            embeds: [new EmbedBuilder().setDescription(`❌ Failed to delete channel: ${error.message}`).setColor('#FF0000')], 
            ephemeral: true 
          }).catch(() => {});
        }
        break;
    }
  } catch (error) {
    logger.error(`Error handling voice channel interaction: ${error.message}`);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ 
        embeds: [new EmbedBuilder().setDescription(`❌ Error: ${error.message}`).setColor('#FF0000')], 
        ephemeral: true 
      }).catch(() => {});
    }
  }
};

module.exports = {
  name: 'voiceStateUpdate',
  handleVoiceChannelInteraction,
  async execute(oldState, newState, client) {
    const guild = newState.guild || oldState.guild;
    const guildId = guild.id;
    const member = newState.member || oldState.member;

    // Verify and fix settings if needed
    const settingsFile = process.env.ABSOLUTE_SETTINGS_PATH;
    try {
      const data = await require('fs').promises.readFile(settingsFile, 'utf8');
      const settings = JSON.parse(data);
      
      // Check if settings need to be reloaded
      const currentSettings = client.settings.get(`${guildId}:jointocreate`);
      const fileSettings = settings[`${guildId}:jointocreate`];
      
      if (!currentSettings && fileSettings) {
        client.settings.set(`${guildId}:jointocreate`, fileSettings);
      }
    } catch (error) {
      logger.error(`Error verifying settings: ${error.message}`);
    }

    // Get created channels from settings
    const createdChannels = getCreatedChannels(client, guildId);

    // Check for join-to-create trigger
    const triggerChannels = client.settings.get(`${guildId}:jointocreate`) || [];
    const isTriggerChannel = triggerChannels.some(tc => tc.channelId === newState.channelId);

    if (isTriggerChannel && newState.channel) {
      try {
        logger.info(`Creating JTC channel for ${member.user.tag} in ${newState.channel.name}`);
        
        // Get the trigger channel settings
        const triggerChannel = triggerChannels.find(tc => tc.channelId === newState.channelId);
        const channelName = triggerChannel.mode === 'sequential' 
          ? `${newState.channel.name} ${createdChannels.size + 1}`
          : `${member.user.username}'s Channel`;
        
        // Create new voice channel
        const vc = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: newState.channel.parent,
          userLimit: triggerChannel.userLimit || 0,
          permissionOverwrites: [
            {
              id: member.id,
              allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.PrioritySpeaker]
            }
          ]
        });

        // Create associated text channel
        const textChannel = await guild.channels.create({
          name: `${channelName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          type: ChannelType.GuildText,
          parent: newState.channel.parent,
          permissionOverwrites: [
            {
              id: member.id,
              allow: [PermissionFlagsBits.ManageChannels]
            }
          ]
        });

        // Move member to new channel
        await member.voice.setChannel(vc);

        // Store channel info
        createdChannels.set(vc.id, {
          ownerId: member.id,
          textChannelId: textChannel.id,
          triggerChannelId: newState.channelId,
          vcId: vc.id,
          mode: triggerChannel.mode,
          userLimit: triggerChannel.userLimit
        });
        
        // Save to settings
        saveCreatedChannels(client, guildId, createdChannels);
        logger.info(`Created JTC channel: ${vc.name} for ${member.user.tag}`);
        
        // Create control panel
        await createControlPanel(textChannel, member);
      } catch (error) {
        logger.error(`Error creating voice channel: ${error.message}`);
      }
    }

    // Handle channel deletion
    if (oldState.channel) {
      const channelData = createdChannels.get(oldState.channelId);
      if (channelData && oldState.channel.members.size === 0) {
        try {
          // Delete the associated text channel first
          if (channelData.textChannelId) {
            const textChannel = await guild.channels.fetch(channelData.textChannelId).catch(() => null);
            if (textChannel) {
              await textChannel.delete();
            }
          }

          // Delete the voice channel
          const voiceChannel = await guild.channels.fetch(channelData.vcId).catch(() => null);
          if (voiceChannel) {
            await voiceChannel.delete();
          }

          // Remove from tracking and save
          createdChannels.delete(channelData.vcId);
          saveCreatedChannels(client, guildId, createdChannels);
          logger.info(`Deleted empty JTC channel: ${oldState.channel.name}`);

        } catch (error) {
          logger.error(`Error deleting empty channel: ${error.message}`);
          // Still try to remove from tracking even if deletion fails
          createdChannels.delete(channelData.vcId);
          saveCreatedChannels(client, guildId, createdChannels);
        }
      }
    }

    // Log voice state changes to modlog
    const modlogChannelId = client.settings.get(`${guildId}:modlog`);
    if (modlogChannelId) {
      const modlogChannel = guild.channels.cache.get(modlogChannelId);
      if (modlogChannel && modlogChannel.isTextBased() && modlogChannel.type !== ChannelType.GuildVoice) {
        const oldChannel = oldState.channel;
        const newChannel = newState.channel;

        let action, color, description;

        if (!oldChannel && newChannel) {
          action = 'Voice Channel Joined';
          color = '#00FF00';
          description = `${member.user.tag} joined ${newChannel.name}.`;
        } else if (oldChannel && !newChannel) {
          action = 'Voice Channel Left';
          color = '#FF4500';
          description = `${member.user.tag} left ${oldChannel.name}.`;
        } else if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
          action = 'Voice Channel Switched';
          color = '#FFD700';
          description = `${member.user.tag} switched from ${oldChannel.name} to ${newChannel.name}.`;
        }

        if (action) {
          const embed = new EmbedBuilder()
            .setTitle(action)
            .setColor(color)
            .setDescription(description)
            .setTimestamp();
          
          await modlogChannel.send({ embeds: [embed] }).catch(error => {
            logger.error(`Error sending to modlog: ${error.message}`);
          });
        }
      }
    }

    // Check if the bot left a voice channel or is alone
    if (member.id === client.user.id) {
      const queue = client.queues.get(guildId);
      const connection = getVoiceConnection(guildId);

      if (oldState.channelId && !newState.channelId && connection) {
        // Bot left the voice channel
        connection.destroy();
        client.queues.delete(guildId);
        logger.info(`Bot left voice channel in guild ${guildId} and cleaned up queue`);
      } else if (newState.channel && newState.channel.members.size === 1 && (!queue || !queue.songs.length)) {
        // Bot is alone in the channel and queue is empty
        setTimeout(() => {
          const updatedConnection = getVoiceConnection(guildId);
          const updatedQueue = client.queues.get(guildId);
          if (updatedConnection && updatedConnection.joinConfig.channelId === newState.channelId && 
              newState.channel.members.size === 1 && (!updatedQueue || !updatedQueue.songs.length)) {
            updatedConnection.destroy();
            client.queues.delete(guildId);
            logger.info(`Bot left voice channel ${newState.channel.name} in guild ${guildId} due to being alone with empty queue`);
          }
        }, 30000); // Wait 30 seconds before leaving if alone
      }
    }

    // Handle music player voice state update if music module exists
    try {
      // Safely check if music player exists before accessing its methods
      if (client.music && typeof client.music.players?.get === 'function') {
        const player = client.music.players.get(oldState.guild.id);
        if (player) {
          // Music player exists, handle voice state update
          // Additional music system logic can go here
          logger.info(`Music player found for guild ${guildId} during voice state update`);
        }
      }
    } catch (error) {
      // Log error but don't crash the whole event
      logger.error(`Error in music player voice state handling: ${error.message}`);
    }
  },
};