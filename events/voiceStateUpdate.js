const { 
  EmbedBuilder, 
  PermissionFlagsBits, 
  ChannelType, 
  ButtonBuilder, 
  ButtonStyle, 
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  getVoiceConnection
} = require('discord.js');
const logger = require('../utils/logger');

const createdChannels = new Map(); // Key: vc.id, Value: { ownerId, textChannelId, triggerChannelId?, vcId }

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState, client) {
    const guild = newState.guild || oldState.guild;
    const guildId = guild.id;
    const member = newState.member || oldState.member;
    logger.info(`Voice state update: User ${member.user.tag} in guild ${guildId}, channel ${newState.channelId || 'left'}`);

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
            .setDescription(description)
            .setColor(color)
            .addFields(
              { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
              { name: 'Time', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
            )
            .setTimestamp();

          try {
            await modlogChannel.send({ embeds: [embed] });
            logger.info(`Logged ${action} for ${member.user.tag} in guild ${guildId}`);
          } catch (err) {
            logger.error(`Failed to log ${action} to modlog channel ${modlogChannelId}: ${err.message}`);
          }
        }
      } else {
        logger.warn(`Modlog channel ${modlogChannelId} not found or not text-based in guild ${guildId}`);
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

    // Join-to-Create logic
    const triggerChannels = client.settings.get(`${guildId}:jointocreate`) || [];
    const trigger = triggerChannels.find(tc => tc.channelId === newState.channelId);
    if (trigger && (!oldState.channelId || oldState.channelId !== newState.channelId)) {
      try {
        const user = newState.member;
        const triggerChannel = newState.channel;
        const category = triggerChannel?.parent;

        if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
          logger.error('Missing ManageChannels permission for Join-to-Create.');
          return;
        }

        let channelName, textChannelName, userLimit;
        if (trigger.mode === 'sequential') {
          const existingChannels = Array.from(createdChannels.values())
            .filter(ch => ch.triggerChannelId === triggerChannel.id)
            .map(ch => guild.channels.cache.get(ch.vcId)?.name)
            .filter(name => name && name.startsWith(triggerChannel.name))
            .map(name => {
              const match = name.match(/\d+$/);
              return match ? parseInt(match[0]) : 0;
            });

          const nextNumber = existingChannels.length ? Math.max(...existingChannels) + 1 : 1;
          channelName = `${triggerChannel.name} ${nextNumber}`;
          textChannelName = `${channelName}-control`;
          userLimit = trigger.userLimit !== undefined ? trigger.userLimit : 2; // Use stored limit or default to 2
        } else {
          channelName = `${user.displayName}'s Channel`;
          textChannelName = `${user.displayName}-control`;
          userLimit = trigger.userLimit !== undefined ? trigger.userLimit : 10; // Use stored limit or default to 10
        }

        const vc = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: category,
          userLimit: userLimit,
          permissionOverwrites: [
            { id: guild.id, allow: [PermissionFlagsBits.Connect] },
            { id: user.id, allow: [PermissionFlagsBits.ManageChannels] },
          ],
        });

        const textChannel = await guild.channels.create({
          name: textChannelName,
          type: ChannelType.GuildText,
          parent: category,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] },
          ],
        });

        createdChannels.set(vc.id, {
          ownerId: user.id,
          textChannelId: textChannel.id,
          ...(trigger.mode === 'sequential' ? { triggerChannelId: triggerChannel.id, vcId: vc.id } : {}),
        });

        await user.voice.setChannel(vc).catch(err => {
          logger.error('Failed to move user to new VC:', err.message);
          throw new Error(`Could not move user: ${err.message}`);
        });

        const invitedUsers = new Set();

        const embed = new EmbedBuilder()
          .setTitle('🎙️ Voice Channel Controls')
          .setDescription('Manage your personal voice channel with style!')
          .setColor('#00BFFF')
          .setThumbnail(client.user.displayAvatarURL())
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
          .setFooter({ text: `Owner: ${user.displayName} | Powered by Bot Boi`, iconURL: user.displayAvatarURL() })
          .setTimestamp();

        const buttons = [
          new ButtonBuilder().setCustomId('lock_channel').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('unlock_channel').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('rename_channel').setEmoji('📛').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('set_limit').setEmoji('👥').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('set_bitrate').setEmoji('🎚️').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('invite_user').setEmoji('👤').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('activity_mode').setEmoji('🎮').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('mute_all').setEmoji('🔇').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('unmute_all').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('kick_user').setEmoji('👢').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('hide_channel').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('delete_channel').setEmoji('🗑️').setStyle(ButtonStyle.Secondary),
        ];

        const actionRows = [];
        for (let i = 0; i < buttons.length; i += 4) {
          const row = new ActionRowBuilder().addComponents(buttons.slice(i, i + 4));
          actionRows.push(row);
        }

        const msg = await textChannel.send({ embeds: [embed], components: actionRows });

        const filter = (interaction) => 
          (interaction.user.id === user.id || interaction.member.permissions.has(PermissionFlagsBits.Administrator)) && 
          interaction.message.id === msg.id;
        const collector = msg.createMessageComponentCollector({ filter, time: 0 });

        collector.on('collect', async (interaction) => {
          try {
            if (!interaction.isButton()) return;

            const customId = interaction.customId;
            if (!customId) {
              logger.error('Interaction missing customId');
              await interaction.reply({ 
                embeds: [new EmbedBuilder().setDescription('❌ Error: Button interaction missing identifier.').setColor('#FF0000')], 
                ephemeral: true 
              });
              return;
            }

            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            if ((customId === 'mute_all' || customId === 'unmute_all') && !isAdmin) {
              await interaction.reply({ 
                embeds: [new EmbedBuilder().setDescription('❌ You need Administrator permissions to use this button!').setColor('#FF0000')], 
                ephemeral: true 
              });
              return;
            }

            switch (customId) {
              case 'lock_channel':
                await vc.permissionOverwrites.edit(guild.id, { [PermissionFlagsBits.Connect]: false });
                await interaction.reply({ 
                  embeds: [new EmbedBuilder().setDescription('🔒 Channel locked!').setColor('#FF4500')], 
                  ephemeral: true 
                });
                break;
              case 'unlock_channel':
                await vc.permissionOverwrites.edit(guild.id, { [PermissionFlagsBits.Connect]: true });
                await interaction.reply({ 
                  embeds: [new EmbedBuilder().setDescription('🔓 Channel unlocked!').setColor('#00FF00')], 
                  ephemeral: true 
                });
                break;
              case 'rename_channel':
                await interaction.showModal({
                  title: 'Rename Channel',
                  customId: 'rename_channel_modal',
                  components: [
                    new ActionRowBuilder().addComponents(
                      new TextInputBuilder()
                        .setCustomId('new_channel_name')
                        .setLabel('New Channel Name')
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(100)
                        .setRequired(true)
                    )
                  ]
                });
                break;
              case 'set_limit':
                await interaction.showModal({
                  title: 'Set User Limit',
                  customId: 'set_limit_modal',
                  components: [
                    new ActionRowBuilder().addComponents(
                      new TextInputBuilder()
                        .setCustomId('user_limit')
                        .setLabel('User Limit (0-99, 0 = no limit)')
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(2)
                        .setRequired(true)
                    )
                  ]
                });
                break;
              case 'set_bitrate':
                await interaction.showModal({
                  title: 'Set Bitrate',
                  customId: 'set_bitrate_modal',
                  components: [
                    new ActionRowBuilder().addComponents(
                      new TextInputBuilder()
                        .setCustomId('bitrate')
                        .setLabel('Bitrate (8-96kbps)')
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(2)
                        .setRequired(true)
                    )
                  ]
                });
                break;
              case 'invite_user':
                await interaction.showModal({
                  title: 'Invite User',
                  customId: 'invite_user_modal',
                  components: [
                    new ActionRowBuilder().addComponents(
                      new TextInputBuilder()
                        .setCustomId('user_id')
                        .setLabel('User Mention or ID')
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(50)
                        .setRequired(true)
                    )
                  ]
                });
                break;
              case 'activity_mode':
                await vc.setRTCRegion('us-east');
                await interaction.reply({ 
                  embeds: [new EmbedBuilder().setDescription('🎮 Activity mode enabled!\nStart an activity from the voice channel menu.').setColor('#00FF00')], 
                  ephemeral: true 
                });
                break;
              case 'mute_all':
                for (const member of vc.members.values()) {
                  if (member.id !== user.id) {
                    await member.voice.setMute(true, 'Muted by channel owner (Mute All)');
                  }
                }
                await interaction.reply({ 
                  embeds: [new EmbedBuilder().setDescription('🔇 All users muted!').setColor('#FF4500')], 
                  ephemeral: true 
                });
                break;
              case 'unmute_all':
                for (const member of vc.members.values()) {
                  await member.voice.setMute(false, 'Unmuted by channel owner (Unmute All)');
                }
                await interaction.reply({ 
                  embeds: [new EmbedBuilder().setDescription('🔊 All users unmuted!').setColor('#00FF00')], 
                  ephemeral: true 
                });
                break;
              case 'kick_user':
                await interaction.showModal({
                  title: 'Kick User',
                  customId: 'kick_user_modal',
                  components: [
                    new ActionRowBuilder().addComponents(
                      new TextInputBuilder()
                        .setCustomId('user_id')
                        .setLabel('User Mention or ID')
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(50)
                        .setRequired(true)
                    )
                  ]
                });
                break;
              case 'hide_channel':
                const currentVisibility = vc.permissionsFor(guild.id).has(PermissionFlagsBits.ViewChannel);
                await vc.permissionOverwrites.edit(guild.id, { 
                  [PermissionFlagsBits.ViewChannel]: !currentVisibility 
                });
                await interaction.reply({ 
                  embeds: [new EmbedBuilder()
                    .setDescription(currentVisibility ? '👁️ Channel hidden from @everyone!' : '👁️ Channel made visible to @everyone!')
                    .setColor(currentVisibility ? '#FF4500' : '#00FF00')], 
                  ephemeral: true 
                });
                break;
              case 'delete_channel':
                await vc.delete();
                await textChannel.delete();
                createdChannels.delete(vc.id);
                collector.stop();
                return;
            }
          } catch (err) {
            logger.error(`Button control error for ${interaction.customId || 'unknown'}: ${err.message}`);
            await interaction.reply({ 
              embeds: [new EmbedBuilder().setDescription(`❌ Error: ${err.message}`).setColor('#FF0000')], 
              ephemeral: true 
            });
          }
        });

        client.on('interactionCreate', async (modalInteraction) => {
          if (!modalInteraction.isModalSubmit()) return;
          if (modalInteraction.user.id !== user.id && !modalInteraction.member.permissions.has(PermissionFlagsBits.Administrator)) return;

          const { customId } = modalInteraction;
          const textChannelData = createdChannels.get(vc.id);
          if (!textChannelData || modalInteraction.channel.id !== textChannelData.textChannelId) return;

          try {
            switch (customId) {
              case 'rename_channel_modal':
                const newName = modalInteraction.fields.getTextInputValue('new_channel_name').slice(0, 100);
                await vc.setName(newName);
                await modalInteraction.reply({ 
                  embeds: [new EmbedBuilder().setDescription(`✅ Renamed to **${newName}**!`).setColor('#00FF00')], 
                  ephemeral: true 
                });
                break;
              case 'set_limit_modal':
                const limit = Math.min(99, Math.max(0, parseInt(modalInteraction.fields.getTextInputValue('user_limit')) || 0));
                await vc.setUserLimit(limit);
                await modalInteraction.reply({ 
                  embeds: [new EmbedBuilder().setDescription(`✅ Limit set to **${limit === 0 ? 'no limit' : `${limit} users`}**!`).setColor('#00FF00')], 
                  ephemeral: true 
                });
                break;
              case 'set_bitrate_modal':
                const bitrate = Math.min(96, Math.max(8, parseInt(modalInteraction.fields.getTextInputValue('bitrate')) || 8)) * 1000;
                await vc.setBitrate(bitrate);
                await modalInteraction.reply({ 
                  embeds: [new EmbedBuilder().setDescription(`✅ Bitrate set to **${bitrate/1000}kbps**!`).setColor('#00FF00')], 
                  ephemeral: true 
                });
                break;
              case 'invite_user_modal':
                const input = modalInteraction.fields.getTextInputValue('user_id');
                const target = modalInteraction.mentions.members.first() || guild.members.cache.get(input.replace(/[<>@!]/g, ''));
                if (!target) {
                  await modalInteraction.reply({ 
                    embeds: [new EmbedBuilder().setDescription('❌ Invalid user!').setColor('#FF4500')], 
                    ephemeral: true 
                  });
                  return;
                }
                await vc.permissionOverwrites.edit(target.id, { [PermissionFlagsBits.Connect]: true, [PermissionFlagsBits.ViewChannel]: true });
                await textChannel.permissionOverwrites.edit(target.id, { [PermissionFlagsBits.ViewChannel]: true });
                invitedUsers.add(target.id);
                await modalInteraction.reply({ 
                  embeds: [new EmbedBuilder().setDescription(`✅ Invited **${target.displayName}**!`).setColor('#00FF00')], 
                  ephemeral: true 
                });
                break;
              case 'kick_user_modal':
                const kickInput = modalInteraction.fields.getTextInputValue('user_id');
                const kickTarget = modalInteraction.mentions.members.first() || guild.members.cache.get(kickInput.replace(/[<>@!]/g, ''));
                if (!kickTarget) {
                  await modalInteraction.reply({ 
                    embeds: [new EmbedBuilder().setDescription('❌ Invalid user!').setColor('#FF4500')], 
                    ephemeral: true 
                  });
                  return;
                }
                if (kickTarget.id === user.id && !isAdmin) {
                  await modalInteraction.reply({ 
                    embeds: [new EmbedBuilder().setDescription('❌ You cannot kick yourself unless you are an admin!').setColor('#FF4500')], 
                    ephemeral: true 
                  });
                  return;
                }
                if (vc.members.has(kickTarget.id)) {
                  await kickTarget.voice.setChannel(null, 'Kicked by channel owner or admin');
                }
                await vc.permissionOverwrites.edit(kickTarget.id, { 
                  [PermissionFlagsBits.Connect]: false, 
                  [PermissionFlagsBits.ViewChannel]: false 
                });
                await modalInteraction.reply({ 
                  embeds: [new EmbedBuilder().setDescription(`👢 Kicked **${kickTarget.displayName}** and banned from rejoining!`).setColor('#FF4500')], 
                  ephemeral: true 
                });
                break;
            }
          } catch (err) {
            logger.error(`Modal control error for ${customId}: ${err.message}`);
            await modalInteraction.reply({ 
              embeds: [new EmbedBuilder().setDescription(`❌ Error: ${err.message}`).setColor('#FF0000')], 
              ephemeral: true 
            });
          }
        });

        const checkEmpty = setInterval(async () => {
          try {
            if (!vc.members.size) {
              await vc.delete().catch(() => {});
              await textChannel.delete().catch(() => {});
              createdChannels.delete(vc.id);
              clearInterval(checkEmpty);
              collector.stop();
            }
          } catch (err) {
            logger.error('Auto-delete error:', err.message);
            clearInterval(checkEmpty);
            collector.stop();
          }
        }, 5000);

      } catch (error) {
        logger.error('Join-to-Create error:', error.message);
        const textChannel = guild.channels.cache.find(ch => ch.name.includes('-control'));
        if (textChannel) {
          await textChannel.send({ content: `Failed to create/move to voice channel: ${error.message}` });
        }
      }
    }
  },
};