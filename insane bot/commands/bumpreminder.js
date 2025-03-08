const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

const REMINDER_FILE = path.join(__dirname, '../data/reminders.json');
const DEFAULT_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

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
    const channelId = interaction.channel.id;

    try {
      let reminders = await loadReminders();

      if (subcommand === 'add') {
        if (reminders[guildId]) {
          return interaction.editReply({ content: 'A bump reminder already exists! Use `/bumpreminder setroles` to update roles.' });
        }

        const role1 = interaction.options.getRole('role1');
        const role2 = interaction.options.getRole('role2');
        const role3 = interaction.options.getRole('role3');
        const roles = [role1.id];
        if (role2) roles.push(role2.id);
        if (role3) roles.push(role3.id);

        reminders[guildId] = {
          interval: DEFAULT_INTERVAL,
          lastSent: null,
          active: true,
          channelId: channelId,
          roles: roles
        };

        await saveReminders(reminders);

        const embed = new EmbedBuilder()
          .setColor('#00FFFF')
          .setTitle('Bump Reminder Added')
          .setDescription(`Roles ${roles.map(id => `<@&${id}>`).join(', ')} will be pinged in this channel 2 hours after each Disboard bump`)
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
          embed.setDescription('No active bump reminder');
        } else {
          const now = Date.now();
          const lastSent = reminder.lastSent ? new Date(reminder.lastSent).getTime() : null;
          const nextTime = lastSent ? lastSent + reminder.interval : null;

          const timeUntilNext = nextTime ? nextTime - now : null;
          const nextReminderText = timeUntilNext ? formatTimeUntil(timeUntilNext) : 'Waiting for first Disboard bump';
          const lastBump = lastSent ? new Date(lastSent).toLocaleString() : 'None';

          embed.setDescription(
            `Active: ${reminder.active}\n` +
            `Last Bump: ${lastBump}\n` +
            `Next Reminder: ${nextReminderText}\n` +
            `Interval: ${reminder.interval / 60000} minutes\n` +
            `Channel: <#${reminder.channelId}>\n` +
            `Roles: ${reminder.roles.map(id => `<@&${id}>`).join(', ')}`
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
      logger.error('Bumpreminder command error:', error.message || error);
      await interaction.editReply({ content: `Error: ${error.message || 'Unknown error'}` });
    }
  },
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

async function loadReminders() {
  try {
    const data = await fs.readFile(REMINDER_FILE, 'utf8');
    if (!data.trim()) {
      logger.info('reminders.json is empty, resetting to empty object');
      await initializeRemindersFile();
      return {};
    }
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info('reminders.json not found, creating with empty object');
      await initializeRemindersFile();
      return {};
    } else if (error.message.includes('Unexpected end of JSON input')) {
      logger.warn('reminders.json is invalid, resetting to empty object');
      await initializeRemindersFile();
      return {};
    }
    logger.error('Failed to load reminders:', error.message || error);
    throw error;
  }
}

async function saveReminders(reminders) {
  try {
    await fs.writeFile(REMINDER_FILE, JSON.stringify(reminders, null, 2));
    logger.info('Successfully saved reminders to reminders.json');
  } catch (error) {
    logger.error('Failed to save reminders:', error.message || error);
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
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn(`Guild ${guildId} not found for reminder`);
      return;
    }

    const reminders = await loadReminders();
    const reminder = reminders[guildId];
    if (!reminder || !reminder.active) return;

    const channel = guild.channels.cache.get(reminder.channelId);
    if (!channel || !channel.isTextBased()) {
      logger.error(`Channel ${reminder.channelId} not found or not text-based for guild ${guildId}`);
      return;
    }

    const rolesToPing = reminder.roles;

    const embed = new EmbedBuilder()
      .setColor('#00FFFF')
      .setTitle('Bump Reminder')
      .setDescription(
        rolesToPing.length > 0
          ? `${rolesToPing.map(id => `<@&${id}>`).join(' ')} Time to bump the server! Use the Disboard /bump command`
          : 'Time to bump the server! Use the Disboard /bump command (no roles specified)'
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    logger.info(`Sent bump reminder to channel ${reminder.channelId} in guild ${guildId} pinging roles: ${rolesToPing.join(', ') || 'none'}`);

    reminders[guildId].lastSent = new Date().toISOString();
    await saveReminders(reminders);
    await scheduleNextReminder(guildId, client);
  } catch (error) {
    logger.error('Send reminder error:', error.message || error);
  }
}

async function scheduleNextReminder(guildId, client, startTime, fromBump = false) {
  try {
    const reminders = await loadReminders();
    const reminder = reminders[guildId];
    if (!reminder || !reminder.active) return;

    const now = Date.now();
    const lastSent = reminder.lastSent ? new Date(reminder.lastSent).getTime() : null;

    if (!lastSent && !fromBump) {
      logger.info(`No bump recorded yet for guild ${guildId}, waiting for Disboard bump`);
      return;
    }

    const nextTime = lastSent + reminder.interval;
    const delay = Math.max(0, nextTime - now);

    logger.info(`Scheduling next reminder for guild ${guildId} in ${delay / 1000 / 60} minutes (at ${new Date(nextTime).toLocaleString()})`);

    setTimeout(() => sendReminder(guildId, client), delay);
  } catch (error) {
    logger.error(`Failed to schedule reminder for guild ${guildId}:`, error.message || error);
  }
}

async function checkReminders(client) {
  try {
    const reminders = await loadReminders();
    const now = Date.now();

    for (const [guildId, reminder] of Object.entries(reminders)) {
      if (!reminder.active) continue;

      const lastSent = reminder.lastSent ? new Date(reminder.lastSent).getTime() : null;
      if (!lastSent) continue;

      const nextTime = lastSent + reminder.interval;

      if (nextTime <= now) {
        logger.info(`Triggering overdue reminder for guild ${guildId} (nextTime: ${new Date(nextTime).toLocaleString()})`);
        await sendReminder(guildId, client);
      } else {
        await scheduleNextReminder(guildId, client);
      }
    }
  } catch (error) {
    logger.error('Reminder check error:', error.message || error);
  }
}

module.exports.checkReminders = checkReminders;
module.exports.loadReminders = loadReminders;
module.exports.saveReminders = saveReminders;
module.exports.sendReminder = sendReminder;
module.exports.scheduleNextReminder = scheduleNextReminder;