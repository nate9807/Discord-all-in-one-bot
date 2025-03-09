const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../utils/logger');
const { sendReminder, scheduleNextReminder, loadReminders, saveReminders } = require('../commands/bumpreminder');

const DISBOARD_BOT_ID = '302050872383242240'; // Disboard's bot ID

// Constants for AutoMod
const DEFAULT_AUTOMOD_CONFIG = {
  enabled: false,
  spamProtection: true,
  contentFilter: true,
  capsProtection: true,
  inviteProtection: true,
  linkProtection: true,
  mentionSpamProtection: true,
  emoteSpamProtection: true,
  zalgoProtection: true,
  newlineSpamProtection: true,
  thresholds: {
    messagesPerSecond: 5,
    repeatedMessageTime: 5000,
    capsPercentage: 0.7,
    maxMentions: 4,
    maxEmotes: 6,
    maxNewlines: 10,
    violationResetTime: 24 * 60 * 60 * 1000, // 24 hours
    warningExpiry: 12 * 60 * 60 * 1000 // 12 hours
  },
  exemptRoles: [], // Array of role IDs that are exempt from automod
  exemptChannels: [], // Array of channel IDs that are exempt from automod
  punishments: {
    warn: { count: 1, action: 'warn' },
    mute: { count: 2, action: 'mute', duration: 5 * 60 * 1000 }, // 5 minutes
    longMute: { count: 3, action: 'mute', duration: 30 * 60 * 1000 }, // 30 minutes
    kick: { count: 4, action: 'kick' },
    ban: { count: 5, action: 'ban' }
  }
};

// Regex patterns for content filtering
const PATTERNS = {
  invites: /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|com|io|me|li)|discordapp\.com)\/(?:invite\/)?([a-zA-Z0-9-]{2,32})/i,
  links: /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g,
  zalgo: /[\u0300-\u036f\u0489]{3,}/g,
  ipGrabbers: /(grabify\.link|iplogger\.org|2no\.co|iplogger\.com|iplogger\.ru|blasze\.com)/i,
  scamDomains: /(nitro-?gift|steam-?gift|free-?nitro|discord-?gift)/i
};

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    try {
      // Skip bot messages except for specific cases (like Disboard)
      if (message.author.bot && message.author.id !== DISBOARD_BOT_ID) {
        return;
      }

      // Return if not in a guild
      if (!message.guild) return;

      // Log the message
      logger.messages(`[${message.guild.name}] [#${message.channel.name}] ${message.author.tag}: ${message.content}`);

      // Get guild settings
      const guildId = message.guild.id;
      const automodConfig = {
        ...DEFAULT_AUTOMOD_CONFIG,
        ...(client.settings.get(`${guildId}:automod`) || {})
      };

      if (!automodConfig.enabled) return;

      // Check for exempt roles and channels
      if (message.member) {
        const hasExemptRole = message.member.roles.cache.some(role => 
          automodConfig.exemptRoles.includes(role.id)
        );
        if (hasExemptRole) return;
      }
      if (automodConfig.exemptChannels.includes(message.channel.id)) return;

      const userId = message.author.id;
      const now = Date.now();

      // Initialize or get automod data
      client.automodData = client.automodData || {
        timestamps: new Map(),
        violations: new Map(),
        lastMessages: new Map(),
        mentionCounts: new Map(),
        emoteCounts: new Map()
      };

      const userTimestamps = client.automodData.timestamps.get(userId) || [];
      const userViolations = client.automodData.violations.get(userId) || { 
        count: 0, 
        lastReset: now, 
        types: {},
        warnings: []
      };
      const lastMessage = client.automodData.lastMessages.get(userId) || { 
        content: '', 
        timestamp: 0 
      };

      // Clean up expired warnings
      userViolations.warnings = userViolations.warnings.filter(warning => 
        now - warning.timestamp < automodConfig.thresholds.warningExpiry
      );

      // Update timestamps for rate limiting
      userTimestamps.push(now);
      const timeWindow = 1000; // 1 second window
      const filteredTimestamps = userTimestamps.filter(ts => now - ts < timeWindow);
      client.automodData.timestamps.set(userId, filteredTimestamps);

      // Enhanced violation handler
      const handleViolation = async (type, reason) => {
        // Reset violations if enough time has passed
        if (now - userViolations.lastReset > automodConfig.thresholds.violationResetTime) {
          userViolations.count = 0;
          userViolations.types = {};
          userViolations.lastReset = now;
          userViolations.warnings = [];
        }

        userViolations.count++;
        userViolations.types[type] = (userViolations.types[type] || 0) + 1;
        userViolations.warnings.push({ timestamp: now, type, reason });
        client.automodData.violations.set(userId, userViolations);

        // Determine punishment based on violation count
        let punishment;
        if (userViolations.count >= automodConfig.punishments.ban.count) {
          punishment = automodConfig.punishments.ban;
        } else if (userViolations.count >= automodConfig.punishments.kick.count) {
          punishment = automodConfig.punishments.kick;
        } else if (userViolations.count >= automodConfig.punishments.longMute.count) {
          punishment = automodConfig.punishments.longMute;
        } else if (userViolations.count >= automodConfig.punishments.mute.count) {
          punishment = automodConfig.punishments.mute;
        } else {
          punishment = automodConfig.punishments.warn;
        }

        // Execute punishment
        let actionTaken;
        switch (punishment.action) {
          case 'ban':
            if (message.member.bannable) {
              await message.member.ban({ reason: `AutoMod: ${reason} (Violation #${userViolations.count})` });
              actionTaken = 'Banned';
            }
            break;
          case 'kick':
            if (message.member.kickable) {
              await message.member.kick(`AutoMod: ${reason} (Violation #${userViolations.count})`);
              actionTaken = 'Kicked';
            }
            break;
          case 'mute':
            if (message.member.moderatable) {
              await message.member.timeout(
                punishment.duration,
                `AutoMod: ${reason} (Violation #${userViolations.count})`
              );
              actionTaken = `Muted (${punishment.duration / 60000} min)`;
            }
            break;
          default:
            actionTaken = 'Warned';
        }

        // Create violation embed
        const embed = new EmbedBuilder()
          .setTitle(`AutoMod Action (${type})`)
          .setDescription(`**User:** ${message.author.tag} (<@${message.author.id}>)\n**Violation #${userViolations.count}**\n**Action:** ${actionTaken}`)
          .setColor('#FF4500')
          .addFields(
            { name: 'Reason', value: reason, inline: false },
            { name: 'Message Content', value: message.content.slice(0, 1000) || 'N/A', inline: false },
            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Previous Violations', value: Object.entries(userViolations.types)
              .map(([t, c]) => `${t}: ${c}`).join('\n') || 'None', inline: false }
          )
          .setTimestamp();

        // Send notification and delete message
        await Promise.all([
          message.channel.send({ embeds: [embed] }),
          message.delete().catch(() => {})
        ]);

        // Log violation
        await this.logViolation(client, message, type, actionTaken, userViolations, reason);
      };

      // Check for spam
      if (automodConfig.spamProtection) {
        const messagesPerSecond = filteredTimestamps.length;
        const isRepeated = message.content === lastMessage.content && 
          (now - lastMessage.timestamp < automodConfig.thresholds.repeatedMessageTime);

        if (messagesPerSecond >= automodConfig.thresholds.messagesPerSecond || isRepeated) {
          await handleViolation(
            isRepeated ? 'Repeated Messages' : 'Message Spam',
            isRepeated ? 'Sending identical messages too quickly' : 'Exceeding message rate limit'
          );
          return;
        }
      }

      // Check for bad words and scam domains
      if (automodConfig.contentFilter) {
        const badWords = client.settings.get(`${guildId}:badwords`) || [];
        const content = message.content.toLowerCase();
        
        // Check for bad words
        if (badWords.some(word => content.includes(word.toLowerCase()))) {
          await handleViolation('Inappropriate Language', 'Use of prohibited words');
          return;
        }

        // Check for scam domains
        if (PATTERNS.scamDomains.test(content)) {
          await handleViolation('Scam Link', 'Potential scam/phishing link detected');
          return;
        }

        // Check for IP grabbers
        if (PATTERNS.ipGrabbers.test(content)) {
          await handleViolation('IP Grabber', 'IP logging service link detected');
          return;
        }
      }

      // Check for excessive caps
      if (automodConfig.capsProtection) {
        const letters = message.content.match(/[a-zA-Z]/g) || [];
        const caps = message.content.match(/[A-Z]/g) || [];
        if (letters.length > 10 && caps.length / letters.length >= automodConfig.thresholds.capsPercentage) {
          await handleViolation('Excessive Caps', 'Using too many capital letters');
          return;
        }
      }

      // Check for unauthorized invites
      if (automodConfig.inviteProtection && !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        if (PATTERNS.invites.test(message.content)) {
          await handleViolation('Unauthorized Invite', 'Posting Discord invites without permission');
          return;
        }
      }

      // Check for excessive mentions
      if (automodConfig.mentionSpamProtection) {
        const mentionCount = message.mentions.users.size + message.mentions.roles.size;
        if (mentionCount > automodConfig.thresholds.maxMentions) {
          await handleViolation('Mention Spam', 'Too many mentions in one message');
          return;
        }
      }

      // Check for emote spam
      if (automodConfig.emoteSpamProtection) {
        const emoteCount = (message.content.match(/<a?:.+?:\d+>/g) || []).length;
        if (emoteCount > automodConfig.thresholds.maxEmotes) {
          await handleViolation('Emote Spam', 'Too many emotes in one message');
          return;
        }
      }

      // Check for zalgo text
      if (automodConfig.zalgoProtection && PATTERNS.zalgo.test(message.content)) {
        await handleViolation('Zalgo Text', 'Use of zalgo/combining characters');
        return;
      }

      // Check for newline spam
      if (automodConfig.newlineSpamProtection) {
        const newlineCount = (message.content.match(/\n/g) || []).length;
        if (newlineCount > automodConfig.thresholds.maxNewlines) {
          await handleViolation('Newline Spam', 'Too many line breaks in one message');
          return;
        }
      }

      // Check for suspicious links
      if (automodConfig.linkProtection && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        const links = message.content.match(PATTERNS.links);
        if (links && links.length > 0) {
          // You could add more sophisticated link checking here
          // For example, checking against a known malicious domain database
          // For now, we'll just log the links
          logger.info(`Links detected in message from ${message.author.tag}: ${links.join(', ')}`);
        }
      }

      // Update last message data
      client.automodData.lastMessages.set(userId, { 
        content: message.content, 
        timestamp: now 
      });

      // Process Disboard bump messages
      if (message.author.bot && message.author.id === DISBOARD_BOT_ID) {
        logger.info(`Disboard message detected - Embeds available: ${message.embeds.length > 0}`);
        if (message.embeds.length > 0) {
          const embed = message.embeds[0];
          const hasBumpEmbed = embed.description && /Bump done!/i.test(embed.description);

          if (hasBumpEmbed) {
            try {
              const channelId = message.channel.id;
              const reminders = await loadReminders();

              if (!reminders[guildId]) {
                logger.info(`Bump detected in ${guildId}, but no reminder configured yet`);
                return;
              }

              if (reminders[guildId].active) {
                reminders[guildId].lastSent = new Date().toISOString();
                reminders[guildId].channelId = channelId;
                await saveReminders(reminders);
                await scheduleNextReminder(guildId, client, null, true);
                logger.info(`Detected "Bump done!" in guild ${guildId}, reset reminder timer`);
              }
            } catch (error) {
              logger.error('Error handling Disboard bump detection:', error.stack);
              message.channel.send('Error processing bump. Check logs.').catch(() => {});
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
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
        { name: 'Message Content', value: message.content || 'N/A', inline: false },
        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
        { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
        { name: 'Violation History', value: Object.entries(violations.types)
          .map(([t, c]) => `${t}: ${c}`).join('\n') || 'N/A', inline: false }
      )
      .setColor('#FF4500')
      .setTimestamp();

    await modlogChannel.send({ embeds: [logEmbed] });
  }
};