const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { sendReminder, scheduleNextReminder, loadReminders, saveReminders } = require('../commands/bumpreminder');

const DISBOARD_BOT_ID = '302050872383242240'; // Disboard's bot ID

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    logger.info(`Message received: "${message.content}" from ${message.author.tag} (${message.author.id}) in ${message.guild ? message.channel.name : 'DM'} at ${new Date().toISOString()}`);

    if (!message.guild) return;

    // Detect Disboard bump confirmation
    if (message.author.bot && message.author.id === DISBOARD_BOT_ID) {
      logger.info(`Disboard message detected - Embeds available: ${message.embeds.length > 0}`);
      if (message.embeds.length > 0) {
        const embed = message.embeds[0];
        logger.info('Disboard embed raw data:', {
          description: embed.description,
          title: embed.title,
          fields: embed.fields,
          footer: embed.footer,
        });
        const hasBumpEmbed = embed.description && /Bump done!/i.test(embed.description);

        if (hasBumpEmbed) {
          try {
            const guildId = message.guild.id;
            const channelId = message.channel.id;
            const reminders = await loadReminders();

            if (!reminders[guildId]) {
              logger.info(`Bump detected in ${guildId}, but no reminder configured yet`);
              return; // Skip if no reminder is set up
            }

            if (reminders[guildId].active) {
              reminders[guildId].lastSent = new Date().toISOString();
              reminders[guildId].channelId = channelId; // Update channel if changed
              await saveReminders(reminders);
              await scheduleNextReminder(guildId, client, null, true);
              logger.info(`Detected "Bump done!" in guild ${guildId}, reset reminder timer`);
            } else {
              logger.info(`Bump detected in ${guildId}, but reminders not active`);
            }
          } catch (error) {
            logger.error('Error handling Disboard bump detection:', error.stack);
            message.channel.send('Error processing bump. Check logs.').catch(() => {});
          }
        } else {
          logger.warn(`Disboard embed found but no "Bump done!" in description: ${embed.description || 'No description'}`);
        }
      } else {
        logger.warn('No embeds found in Disboard message');
      }
      return; // Exit early for Disboard messages
    }

    if (message.author.bot) return; // Skip further processing for bot messages

    const guildId = message.guild.id;
    const automodConfig = client.settings.get(`${guildId}:automod`) || {
      enabled: false,
      spamProtection: true,
      contentFilter: true,
      capsProtection: true,
      inviteProtection: true,
      thresholds: {
        messagesPerSecond: 5,
        repeatedMessageTime: 5000,
        capsPercentage: 0.7,
        violationResetTime: 24 * 60 * 60 * 1000
      }
    };

    if (!automodConfig.enabled) return;

    const userId = message.author.id;
    const now = Date.now();
    client.automodData = client.automodData || {
      timestamps: new Map(),
      violations: new Map(),
      lastMessages: new Map()
    };

    const userTimestamps = client.automodData.timestamps.get(userId) || [];
    const userViolations = client.automodData.violations.get(userId) || { count: 0, lastReset: now, types: {} };
    const lastMessage = client.automodData.lastMessages.get(userId) || { content: '', timestamp: 0 };

    userTimestamps.push(now);
    const timeWindow = 1000;
    const filteredTimestamps = userTimestamps.filter(ts => now - ts < timeWindow);
    client.automodData.timestamps.set(userId, filteredTimestamps);

    const handleViolation = async (type, reason) => {
      if (now - userViolations.lastReset > automodConfig.thresholds.violationResetTime) {
        userViolations.count = 0;
        userViolations.types = {};
        userViolations.lastReset = now;
      }

      userViolations.count++;
      userViolations.types[type] = (userViolations.types[type] || 0) + 1;
      client.automodData.violations.set(userId, userViolations);

      const actions = {
        1: { action: 'Warned', execute: () => Promise.resolve() },
        2: { action: 'Muted (5 min)', execute: () => message.member.moderatable ? message.member.timeout(5 * 60 * 1000, reason) : Promise.resolve() },
        3: { action: 'Muted (30 min)', execute: () => message.member.moderatable ? message.member.timeout(30 * 60 * 1000, reason) : Promise.resolve() },
        4: { action: 'Kicked', execute: () => message.member.kickable ? message.member.kick(reason) : Promise.resolve() },
        5: { action: 'Banned', execute: () => message.member.bannable ? message.member.ban({ reason }) : Promise.resolve() }
      };

      const actionKey = userViolations.count > 5 ? 5 : userViolations.count;
      const { action, execute } = actions[actionKey] || actions[5];

      const embed = new EmbedBuilder()
        .setTitle(`AutoMod Action (${type})`)
        .setDescription(`**User:** ${message.author.tag} (<@${message.author.id}>)\n**Violation #${userViolations.count}**\n**Action:** ${action}`)
        .setColor('#FF4500')
        .addFields(
          { name: 'Reason', value: reason, inline: false },
          { name: 'Message Content', value: message.content.slice(0, 1000) || 'N/A', inline: false },
          { name: 'Channel', value: `<#${message.channel.id}>`, inline: true }
        )
        .setTimestamp();

      await Promise.all([
        message.channel.send({ embeds: [embed] }),
        message.delete(),
        execute()
      ]);

      await this.logViolation(client, message, type, action, userViolations, reason);
    };

    if (automodConfig.spamProtection) {
      const messagesPerSecond = filteredTimestamps.length;
      const isRepeated = message.content === lastMessage.content && (now - lastMessage.timestamp < automodConfig.thresholds.repeatedMessageTime);

      if (messagesPerSecond >= automodConfig.thresholds.messagesPerSecond || isRepeated) {
        await handleViolation(
          isRepeated ? 'Repeated Messages' : 'Message Spam',
          isRepeated ? 'Sending identical messages too quickly' : 'Exceeding message rate limit'
        );
        return;
      }
    }

    if (automodConfig.contentFilter) {
      const badWords = client.settings.get(`${guildId}:badwords`) || [];
      if (badWords.some(word => message.content.toLowerCase().includes(word.toLowerCase()))) {
        await handleViolation('Inappropriate Language', 'Use of prohibited words');
        return;
      }
    }

    if (automodConfig.capsProtection) {
      const letters = message.content.match(/[a-zA-Z]/g) || [];
      const caps = message.content.match(/[A-Z]/g) || [];
      if (letters.length > 10 && caps.length / letters.length >= automodConfig.thresholds.capsPercentage) {
        await handleViolation('Excessive Caps', 'Using too many capital letters');
        return;
      }
    }

    if (automodConfig.inviteProtection) {
      const inviteRegex = /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|com|io|me|li)|discordapp\.com)\/(?:invite\/)?([a-zA-Z0-9-]{2,32})/i;
      if (inviteRegex.test(message.content) && !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await handleViolation('Unauthorized Invite', 'Posting Discord invites without permission');
        return;
      }
    }

    client.automodData.lastMessages.set(userId, { content: message.content, timestamp: now });
  },

  async logViolation(client, message, type, action, violations, reason) {
    const modlogChannelId = client.settings.get(`${message.guild.id}:modlog`);
    if (!modlogChannelId) return;

    const modlogChannel = client.channels.cache.get(modlogChannelId);
    if (!modlogChannel) return;

    const logEmbed = new EmbedBuilder()
      .setTitle(`AutoMod Log (${type})`)
      .setDescription(`**User:** ${message.author.tag} (${message.author.id})\n**Action:** ${action}\n**Total Violations:** ${violations.count}`)
      .addFields(
        { name: 'Reason', value: reason, inline: false },
        { name: 'Message Content', value: description || 'N/A', inline: false },
        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
        { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
        { name: 'Violation Breakdown', value: Object.entries(violations.types).map(([t, c]) => `${t}: ${c}`).join('\n') || 'N/A', inline: false }
      )
      .setColor('#FF4500')
      .setTimestamp();

    await modlogChannel.send({ embeds: [logEmbed] });
  }
};