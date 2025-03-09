const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backup')
        .setDescription('Backup and restore server settings')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Create a new backup')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name for the backup')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all available backups'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('load')
                .setDescription('Load a backup')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the backup to load')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a backup')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the backup to delete')
                        .setRequired(true))),
    cooldown: 10,

    async execute(interaction, client) {
        // Check for administrator permissions
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: 'You need Administrator permissions to use this command!',
                ephemeral: true
            });
        }

        try {
            const subcommand = interaction.options.getSubcommand();

            switch (subcommand) {
                case 'create':
                    await this.handleCreate(interaction, client);
                    break;
                case 'list':
                    await this.handleList(interaction, client);
                    break;
                case 'load':
                    await this.handleLoad(interaction, client);
                    break;
                case 'delete':
                    await this.handleDelete(interaction, client);
                    break;
            }
        } catch (error) {
            logger.error('Error in backup command:', error);
            await interaction.reply({
                content: 'There was an error executing the backup command.',
                ephemeral: true
            });
        }
    },

    async handleCreate(interaction, client) {
        await interaction.deferReply();

        try {
            const guildId = interaction.guild.id;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupName = interaction.options.getString('name') || `backup-${timestamp}`;
            
            // Create backup data object
            const backupData = {
                name: backupName,
                timestamp: Date.now(),
                guild: {
                    id: guildId,
                    name: interaction.guild.name
                },
                settings: {},
                roles: [],
                channels: []
            };

            // Backup all settings for this guild
            for (const [key, value] of client.settings.entries()) {
                if (key.startsWith(`${guildId}:`)) {
                    backupData.settings[key] = value;
                }
            }

            // Backup roles (excluding @everyone)
            const roles = interaction.guild.roles.cache
                .filter(role => role.id !== interaction.guild.id)
                .map(role => ({
                    name: role.name,
                    color: role.color,
                    hoist: role.hoist,
                    permissions: role.permissions.toArray(),
                    mentionable: role.mentionable,
                    position: role.position
                }));
            backupData.roles = roles;

            // Backup channels
            const channels = interaction.guild.channels.cache.map(channel => ({
                name: channel.name,
                type: channel.type,
                parent: channel.parent?.name,
                position: channel.position,
                topic: channel.topic,
                nsfw: channel.nsfw,
                bitrate: channel.bitrate,
                userLimit: channel.userLimit,
                permissionOverwrites: channel.permissionOverwrites.cache.map(perm => ({
                    id: perm.id,
                    type: perm.type,
                    allow: perm.allow.toArray(),
                    deny: perm.deny.toArray()
                }))
            }));
            backupData.channels = channels;

            // Save backup
            const backupsDir = path.join(__dirname, '../backups');
            await fs.mkdir(backupsDir, { recursive: true });
            await fs.writeFile(
                path.join(backupsDir, `${guildId}_${backupName}.json`),
                JSON.stringify(backupData, null, 2)
            );

            const embed = new EmbedBuilder()
                .setTitle('Backup Created')
                .setDescription(`
                    **Name:** ${backupName}
                    **Settings Backed Up:** ${Object.keys(backupData.settings).length}
                    **Roles Backed Up:** ${backupData.roles.length}
                    **Channels Backed Up:** ${backupData.channels.length}
                `)
                .setColor('#00FF00')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            logger.error('Error creating backup:', error);
            await interaction.editReply('Failed to create backup. Check the logs for more information.');
        }
    },

    async handleList(interaction, client) {
        try {
            const backupsDir = path.join(__dirname, '../backups');
            await fs.mkdir(backupsDir, { recursive: true });
            
            const files = await fs.readdir(backupsDir);
            const guildBackups = files.filter(f => f.startsWith(`${interaction.guild.id}_`));

            if (guildBackups.length === 0) {
                return interaction.reply('No backups found for this server.');
            }

            const backupList = await Promise.all(guildBackups.map(async file => {
                const content = await fs.readFile(path.join(backupsDir, file), 'utf8');
                const backup = JSON.parse(content);
                return {
                    name: backup.name,
                    timestamp: backup.timestamp,
                    settings: Object.keys(backup.settings).length,
                    roles: backup.roles.length,
                    channels: backup.channels.length
                };
            }));

            const embed = new EmbedBuilder()
                .setTitle('Server Backups')
                .setDescription(
                    backupList.map(b => 
                        `**${b.name}**\n` +
                        `Created: <t:${Math.floor(b.timestamp / 1000)}:R>\n` +
                        `Settings: ${b.settings} | Roles: ${b.roles} | Channels: ${b.channels}\n`
                    ).join('\n')
                )
                .setColor('#00FFFF')
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            logger.error('Error listing backups:', error);
            await interaction.reply('Failed to list backups. Check the logs for more information.');
        }
    },

    async handleLoad(interaction, client) {
        const backupName = interaction.options.getString('name');
        const guildId = interaction.guild.id;
        const backupFile = path.join(__dirname, '../backups', `${guildId}_${backupName}.json`);

        try {
            // Check if backup exists
            const backupExists = await fs.access(backupFile)
                .then(() => true)
                .catch(() => false);

            if (!backupExists) {
                return interaction.reply({
                    content: 'Backup not found!',
                    ephemeral: true
                });
            }

            // Confirm action
            const confirmEmbed = new EmbedBuilder()
                .setTitle('⚠️ Confirmation Required')
                .setDescription(
                    'Loading a backup will:\n' +
                    '1. Restore all backed up settings\n' +
                    '2. Restore role configurations\n' +
                    '3. Update channel permissions\n\n' +
                    'Are you sure you want to proceed?'
                )
                .setColor('#FFA500')
                .setTimestamp();

            await interaction.reply({
                embeds: [confirmEmbed],
                ephemeral: true
            });

            // Load backup data
            const backupContent = await fs.readFile(backupFile, 'utf8');
            const backupData = JSON.parse(backupContent);

            // Restore settings
            for (const [key, value] of Object.entries(backupData.settings)) {
                client.settings.set(key, value);
            }

            // Restore roles (update existing, create missing)
            for (const roleData of backupData.roles) {
                const existingRole = interaction.guild.roles.cache
                    .find(r => r.name === roleData.name);

                if (existingRole) {
                    await existingRole.edit({
                        color: roleData.color,
                        hoist: roleData.hoist,
                        permissions: roleData.permissions,
                        mentionable: roleData.mentionable
                    });
                } else {
                    await interaction.guild.roles.create({
                        name: roleData.name,
                        color: roleData.color,
                        hoist: roleData.hoist,
                        permissions: roleData.permissions,
                        mentionable: roleData.mentionable,
                        position: roleData.position
                    });
                }
            }

            // Update channel permissions
            for (const channelData of backupData.channels) {
                const channel = interaction.guild.channels.cache
                    .find(ch => ch.name === channelData.name);

                if (channel) {
                    // Update permission overwrites
                    await channel.permissionOverwrites.set(
                        channelData.permissionOverwrites.map(perm => ({
                            id: perm.id,
                            allow: perm.allow,
                            deny: perm.deny
                        }))
                    );
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('Backup Loaded')
                .setDescription(`
                    **Name:** ${backupData.name}
                    **Settings Restored:** ${Object.keys(backupData.settings).length}
                    **Roles Updated:** ${backupData.roles.length}
                    **Channels Updated:** ${backupData.channels.length}
                `)
                .setColor('#00FF00')
                .setTimestamp();

            await interaction.followUp({ embeds: [embed] });
        } catch (error) {
            logger.error('Error loading backup:', error);
            await interaction.reply('Failed to load backup. Check the logs for more information.');
        }
    },

    async handleDelete(interaction, client) {
        const backupName = interaction.options.getString('name');
        const guildId = interaction.guild.id;
        const backupFile = path.join(__dirname, '../backups', `${guildId}_${backupName}.json`);

        try {
            // Check if backup exists
            const backupExists = await fs.access(backupFile)
                .then(() => true)
                .catch(() => false);

            if (!backupExists) {
                return interaction.reply({
                    content: 'Backup not found!',
                    ephemeral: true
                });
            }

            // Delete the backup file
            await fs.unlink(backupFile);

            const embed = new EmbedBuilder()
                .setTitle('Backup Deleted')
                .setDescription(`Successfully deleted backup: ${backupName}`)
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            logger.error('Error deleting backup:', error);
            await interaction.reply('Failed to delete backup. Check the logs for more information.');
        }
    }
}; 