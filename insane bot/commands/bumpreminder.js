const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

const REMINDER_FILE = path.join(__dirname, '../data/reminders.json');
const DEFAULT_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_INACTIVE_TIME = 7 * 24 * 60 * 60 * 1000; // 7 days

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bumpreminder')
    .setDescription('Manage bump reminders for specified roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a bump reminder for specified roles')
        .addRoleOption(option =>
          option.setName('role1').setDescription('First role to ping').setRequired(true)
        )
        .addRoleOption(option =>
          option.setName('role2').setDescription('Second role to ping (optional)').setRequired(false)
        )
        .addRoleOption(option =>
          option.setName('role3').setDescription('Third role to ping (optional)').setRequired(false)
        )
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel for reminders (defaults to current channel)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('remove').setDescription('Remove the bump reminder')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('status').setDescription('Check current reminder status')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('setroles')
        .setDescription('Update the roles to ping for the reminder')
        .addRoleOption(option =>
          option.setName('role1').setDescription('First role to ping').setRequired(true)
        )
        .addRoleOption(option =>
          option.setName('role2').setDescription('Second role to ping (optional)').setRequired(false)
        )
        .addRoleOption(option =>
          option.setName('role3').setDescription('Third role to ping (optional)').setRequired(false)
        )
    ),
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const channelId = interaction.options.getChannel('channel')?.id || interaction.channel.id;

    try {
      // Validate guild and channel
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        throw new Error('Unable to access guild');
      }

      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error('Invalid or non-text channel specified');
      }

      // Load reminders with retry mechanism
      let reminders = await retryOperation(loadReminders);

      if (subcommand === 'add') {
        if (reminders[guildId]) {
          return interaction.editReply({ 
            content: 'A bump reminder already exists! Use `/bumpreminder setroles` to update roles.',
            ephemeral: true 
          });
        }

        const role1 = interaction.options.getRole('role1');
        const role2 = interaction.options.getRole('role2');
        const role3 = interaction.options.getRole('role3');

        // Validate roles
        const roles = [role1, role2, role3]
          .filter(role => role !== null)
          .map(role => {
            if (!guild.roles.cache.has(role.id)) {
              throw new Error(`Role ${role.name} not found in the server`);
            }
            return role.id;
          });

        if (roles.length === 0) {
          throw new Error('At least one valid role must be specified');
        }

        reminders[guildId] = {
          interval: DEFAULT_INTERVAL,
          lastSent: null,
          active: true,
          channelId: channelId,
          roles: roles,
          createdAt: Date.now(),
          lastActivity: Date.now()
        };

        await saveReminders(reminders);

        const embed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Bump Reminder Added')
          .setDescription(
            `Reminder set up successfully!\n\n` +
            `Channel: <#${channelId}>\n` +
            `Roles: ${roles.map(id => `<@&${id}>`).join(', ')}\n` +
            `Interval: 2 hours\n\n` +
            `The reminder will be sent automatically after each Disboard bump.`
          )
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });

      } else if (subcommand === 'remove') {
        if (!reminders[guildId]) {
          return interaction.editReply({ content: 'No bump reminder exists for this server!' });
        }

        delete reminders[guildId];
        await saveReminders(reminders);

        const embed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Bump Reminder Removed')
          .setDescription('Bump reminders have been disabled')
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });

      } else if (subcommand === 'status') {
        const reminder = reminders[guildId];
        const embed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Bump Reminder Status')
          .setTimestamp();

        if (!reminder) {
          embed.setDescription('No active bump reminder in this server.');
        } else {
          const now = Date.now();
          const lastSent = reminder.lastSent ? new Date(reminder.lastSent).getTime() : null;
          const nextTime = lastSent ? lastSent + reminder.interval : null;
          const timeUntilNext = nextTime ? nextTime - now : null;
          
          const uptime = now - (reminder.createdAt || now);
          const lastActivity = reminder.lastActivity ? formatTimeAgo(now - reminder.lastActivity) : 'Never';

          embed.setDescription(
            `**Status**: ${reminder.active ? '🟢 Active' : '🔴 Inactive'}\n` +
            `**Channel**: <#${reminder.channelId}>\n` +
            `**Roles**: ${reminder.roles.map(id => `<@&${id}>`).join(', ')}\n` +
            `**Last Bump**: ${lastSent ? formatTimeAgo(now - lastSent) : 'Never'}\n` +
            `**Next Reminder**: ${timeUntilNext ? formatTimeUntil(timeUntilNext) : 'Waiting for bump'}\n` +
            `**Uptime**: ${formatTimeUntil(uptime)}\n` +
            `**Last Activity**: ${lastActivity}`
          );
        }

        await interaction.editReply({ embeds: [embed] });

      } else if (subcommand === 'setroles') {
        if (!reminders[guildId]) {
          return interaction.editReply({ content: 'No bump reminder exists! Use `/bumpreminder add` first.' });
        }

        const role1 = interaction.options.getRole('role1');
        const role2 = interaction.options.getRole('role2');
        const role3 = interaction.options.getRole('role3');
        const roles = [role1.id];
        if (role2) roles.push(role2.id);
        if (role3) roles.push(role3.id);

        reminders[guildId].roles = roles;
        await saveReminders(reminders);

        const embed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Bump Reminder Roles Updated')
          .setDescription(`Roles ${roles.map(id => `<@&${id}>`).join(', ')} will now be pinged`)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      logger.error('Bumpreminder command error:', error);
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Error')
        .setDescription(`Failed to process command: ${error.message}`)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
    }
  },
  sendReminder,
  scheduleNextReminder,
  loadReminders,
  saveReminders,
  formatTimeUntil,
  formatTimeAgo
};

function formatTimeUntil(milliseconds) {
  if (milliseconds <= 0) return 'Now';

  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const remainingHours = hours % 24;
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (remainingHours > 0) parts.push(`${remainingHours} hour${remainingHours > 1 ? 's' : ''}`);
  if (remainingMinutes > 0) parts.push(`${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`);
  if (parts.length === 0 && remainingSeconds > 0) parts.push(`${remainingSeconds} second${remainingSeconds > 1 ? 's' : ''}`);

  return parts.join(', ') || 'Less than a second';
}

function formatTimeAgo(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function retryOperation(operation, maxRetries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
    }
  }
}

async function loadReminders() {
  try {
    const data = await fs.readFile(REMINDER_FILE, 'utf8');
    if (!data.trim()) {
      logger.info('reminders.json is empty, initializing');
      return {};
    }

    const reminders = JSON.parse(data);
    
    // Validate and clean up reminders
    const now = Date.now();
    Object.entries(reminders).forEach(([guildId, reminder]) => {
      // Remove invalid or very old inactive reminders
      if (!reminder || 
          !reminder.roles || 
          !reminder.channelId ||
          (now - reminder.lastActivity > MAX_INACTIVE_TIME)) {
        delete reminders[guildId];
        logger.info(`Removed invalid/inactive reminder for guild ${guildId}`);
      }
    });

    return reminders;
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info('reminders.json not found, creating new file');
      await initializeRemindersFile();
      return {};
    }
    throw error;
  }
}

async function saveReminders(reminders) {
  const backupFile = `${REMINDER_FILE}.backup`;
  try {
    // Create backup of current file if it exists
    try {
      await fs.copyFile(REMINDER_FILE, backupFile);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn('Failed to create backup:', error);
      }
    }

    // Save new data
    await fs.writeFile(REMINDER_FILE, JSON.stringify(reminders, null, 2));
    logger.info('Successfully saved reminders');
  } catch (error) {
    logger.error('Failed to save reminders:', error);
    // Try to restore from backup
    try {
      await fs.copyFile(backupFile, REMINDER_FILE);
      logger.info('Restored from backup after save failure');
    } catch (restoreError) {
      logger.error('Failed to restore from backup:', restoreError);
    }
    throw error;
  }
}

async function initializeRemindersFile() {
  try {
    const dataDir = path.dirname(REMINDER_FILE);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(REMINDER_FILE, JSON.stringify({}, null, 2));
    logger.info('Created/reset reminders.json with empty object');
  } catch (error) {
    logger.error('Failed to initialize reminders.json:', error.message || error);
    throw error;
  }
}

async function sendReminder(guildId, client) {
  try {
    const reminders = await retryOperation(() => loadReminders());
    const reminder = reminders[guildId];
    
    if (!reminder || !reminder.active) {
      logger.info(`Skipping inactive reminder for guild ${guildId}`);
      return;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn(`Guild ${guildId} not found for reminder - marking inactive`);
      reminder.active = false;
      await saveReminders(reminders);
      return;
    }

    const channel = guild.channels.cache.get(reminder.channelId);
    if (!channel || !channel.isTextBased()) {
      logger.error(`Channel ${reminder.channelId} not found or not text-based for guild ${guildId} - marking inactive`);
      reminder.active = false;
      await saveReminders(reminders);
      return;
    }

    // Validate roles still exist
    const validRoles = [];
    const invalidRoles = [];
    for (const roleId of reminder.roles) {
      const role = guild.roles.cache.get(roleId);
      if (role) {
        validRoles.push(roleId);
      } else {
        invalidRoles.push(roleId);
      }
    }

    if (invalidRoles.length > 0) {
      logger.warn(`Found ${invalidRoles.length} invalid roles for guild ${guildId} - removing them`);
      reminder.roles = validRoles;
      await saveReminders(reminders);
    }

    if (validRoles.length === 0) {
      logger.error(`No valid roles remain for guild ${guildId} - marking inactive`);
      reminder.active = false;
      await saveReminders(reminders);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle('Time to Bump! 🚀')
      .setDescription(
        `Hey ${validRoles.map(id => `<@&${id}>`).join(', ')}!\n\n` +
        `It's time to bump the server using \`/bump\`!\n` +
        `This helps increase server visibility and attract new members.`
      )
      .setTimestamp();

    try {
      await channel.send({ 
        content: validRoles.map(id => `<@&${id}>`).join(' '),
        embeds: [embed]
      });
      
      reminder.lastSent = Date.now();
      reminder.lastActivity = Date.now();
      await saveReminders(reminders);
      
      logger.info(`Successfully sent reminder for guild ${guildId}`);
      
      // Schedule the next reminder
      scheduleNextReminder(guildId, client, Date.now());
    } catch (error) {
      logger.error(`Failed to send reminder for guild ${guildId}:`, error);
      if (error.code === 50013) { // Missing Permissions
        reminder.active = false;
        await saveReminders(reminders);
      }
      throw error;
    }
  } catch (error) {
    logger.error('Error in sendReminder:', error);
  }
}

async function scheduleNextReminder(guildId, client, startTime = null, fromBump = false) {
  try {
    const reminders = await retryOperation(() => loadReminders());
    const reminder = reminders[guildId];
    
    if (!reminder || !reminder.active) return;

    const now = Date.now();
    reminder.lastActivity = now;
    
    // If this is from a bump, update the lastSent time
    if (fromBump) {
      logger.info(`Bump detected for guild ${guildId}, resetting timer`);
      reminder.lastSent = now;
      await saveReminders(reminders);
    }
    
    // Use provided startTime or lastSent time or current time
    const baseTime = startTime || reminder.lastSent || now;
    const nextTime = baseTime + reminder.interval;
    const delay = Math.max(0, nextTime - now);

    // Clear any existing timeout for this guild
    if (client.bumpTimeouts && client.bumpTimeouts[guildId]) {
      clearTimeout(client.bumpTimeouts[guildId]);
      logger.info(`Cleared existing timeout for guild ${guildId}`);
    }
    
    // Initialize the timeouts object if it doesn't exist
    if (!client.bumpTimeouts) {
      client.bumpTimeouts = {};
    }
    
    // Set the new timeout
    if (delay > 0) {
      logger.info(`Scheduling next reminder for guild ${guildId} in ${formatTimeUntil(delay)} (${new Date(now + delay).toISOString()})`);
      client.bumpTimeouts[guildId] = setTimeout(() => sendReminder(guildId, client), delay);
    } else {
      logger.info(`Sending immediate reminder for guild ${guildId} (delay was ${delay}ms)`);
      sendReminder(guildId, client);
    }

    await saveReminders(reminders);
  } catch (error) {
    logger.error('Error in scheduleNextReminder:', error);
  }
}

async function checkReminders(client) {
  try {
    const reminders = await retryOperation(() => loadReminders());
    const now = Date.now();
    let changed = false;

    for (const [guildId, reminder] of Object.entries(reminders)) {
      // Skip already inactive reminders
      if (!reminder.active) continue;

      // Check if reminder is too old without activity
      if (now - reminder.lastActivity > MAX_INACTIVE_TIME) {
        logger.info(`Deactivating inactive reminder for guild ${guildId}`);
        reminder.active = false;
        changed = true;
        continue;
      }

      // Validate guild still exists and bot has access
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        logger.warn(`Guild ${guildId} not found - deactivating reminder`);
        reminder.active = false;
        changed = true;
        continue;
      }

      // Validate channel still exists and is accessible
      const channel = guild.channels.cache.get(reminder.channelId);
      if (!channel || !channel.isTextBased()) {
        logger.warn(`Channel ${reminder.channelId} not found or not text-based - deactivating reminder`);
        reminder.active = false;
        changed = true;
        continue;
      }

      // Check if any valid roles remain
      const validRoles = reminder.roles.filter(roleId => guild.roles.cache.has(roleId));
      if (validRoles.length === 0) {
        logger.warn(`No valid roles remain for guild ${guildId} - deactivating reminder`);
        reminder.active = false;
        changed = true;
        continue;
      }

      // Update roles if some were invalid
      if (validRoles.length !== reminder.roles.length) {
        logger.info(`Updating roles for guild ${guildId} - removed ${reminder.roles.length - validRoles.length} invalid roles`);
        reminder.roles = validRoles;
        changed = true;
      }

      // Check if we missed any reminders while offline
      if (reminder.lastSent) {
        const timeSinceLastReminder = now - reminder.lastSent;
        if (timeSinceLastReminder > reminder.interval) {
          logger.info(`Missed reminder for guild ${guildId} - scheduling new one`);
          scheduleNextReminder(guildId, client, now);
        }
      }
    }

    if (changed) {
      await saveReminders(reminders);
    }
  } catch (error) {
    logger.error('Error in checkReminders:', error);
  }

  // Schedule next cleanup
  setTimeout(() => checkReminders(client), CLEANUP_INTERVAL);
}

module.exports.checkReminders = checkReminders;
module.exports.loadReminders = loadReminders;
module.exports.saveReminders = saveReminders;
module.exports.sendReminder = sendReminder;
module.exports.scheduleNextReminder = scheduleNextReminder;