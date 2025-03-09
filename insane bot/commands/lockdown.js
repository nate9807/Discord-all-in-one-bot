const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lockdown')
        .setDescription('Lock or unlock channels')
        .addSubcommand(subcommand =>
            subcommand
                .setName('lock')
                .setDescription('Lock a channel or the entire server')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to lock (leave empty for current channel)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory)
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Reason for the lockdown')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('server')
                        .setDescription('Lock down the entire server')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('unlock')
                .setDescription('Unlock a channel or the entire server')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to unlock (leave empty for current channel)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory)
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('server')
                        .setDescription('Unlock the entire server')
                        .setRequired(false))),
    cooldown: 5,

    async execute(interaction, client) {
        // Check for required permissions
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({
                content: 'You need Manage Channels permission to use this command!',
                ephemeral: true
            });
        }

        try {
            const subcommand = interaction.options.getSubcommand();
            const isLocking = subcommand === 'lock';
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const server = interaction.options.getBoolean('server') || false;

            if (server) {
                await this.handleServerLockdown(interaction, isLocking, reason);
            } else {
                await this.handleChannelLockdown(interaction, channel, isLocking, reason);
            }
        } catch (error) {
            logger.error('Error in lockdown command:', error);
            await interaction.reply({
                content: 'There was an error executing the lockdown command.',
                ephemeral: true
            });
        }
    },

    async handleServerLockdown(interaction, isLocking, reason) {
        const guild = interaction.guild;
        const channels = guild.channels.cache.filter(ch => 
            ch.type === ChannelType.GuildText || 
            ch.type === ChannelType.GuildVoice
        );

        let successCount = 0;
        let failCount = 0;

        await interaction.deferReply();

        for (const [, channel] of channels) {
            try {
                await this.lockChannel(channel, isLocking);
                successCount++;
            } catch (error) {
                logger.error(`Error ${isLocking ? 'locking' : 'unlocking'} channel ${channel.name}:`, error);
                failCount++;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`Server ${isLocking ? 'Lockdown' : 'Unlock'} Complete`)
            .setDescription(`
                **Reason:** ${reason}
                **Successful:** ${successCount} channels
                **Failed:** ${failCount} channels
            `)
            .setColor(isLocking ? '#FF0000' : '#00FF00')
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Log the action
        const logEmbed = new EmbedBuilder()
            .setTitle(`Server ${isLocking ? 'Locked Down' : 'Unlocked'}`)
            .setDescription(`
                **Moderator:** ${interaction.user.tag}
                **Reason:** ${reason}
                **Affected Channels:** ${successCount}
                **Failed Channels:** ${failCount}
            `)
            .setColor(isLocking ? '#FF0000' : '#00FF00')
            .setTimestamp();

        // Send log if logging channel is set
        const logChannelId = client.settings.get(`${interaction.guild.id}:logChannel`);
        if (logChannelId) {
            try {
                const logChannel = await interaction.guild.channels.fetch(logChannelId);
                await logChannel.send({ embeds: [logEmbed] });
            } catch (error) {
                logger.error('Error sending lockdown log:', error);
            }
        }
    },

    async handleChannelLockdown(interaction, channel, isLocking, reason) {
        try {
            await this.lockChannel(channel, isLocking);

            const embed = new EmbedBuilder()
                .setTitle(`Channel ${isLocking ? 'Locked' : 'Unlocked'}`)
                .setDescription(`
                    **Channel:** ${channel}
                    **Reason:** ${reason}
                    **Moderator:** ${interaction.user.tag}
                `)
                .setColor(isLocking ? '#FF0000' : '#00FF00')
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

            // Log the action
            const logChannelId = client.settings.get(`${interaction.guild.id}:logChannel`);
            if (logChannelId) {
                try {
                    const logChannel = await interaction.guild.channels.fetch(logChannelId);
                    await logChannel.send({ embeds: [embed] });
                } catch (error) {
                    logger.error('Error sending lockdown log:', error);
                }
            }
        } catch (error) {
            logger.error(`Error ${isLocking ? 'locking' : 'unlocking'} channel:`, error);
            await interaction.reply({
                content: `Failed to ${isLocking ? 'lock' : 'unlock'} the channel. Make sure I have the required permissions.`,
                ephemeral: true
            });
        }
    },

    async lockChannel(channel, isLocking) {
        // Store original permissions if locking
        if (isLocking) {
            const originalPerms = channel.permissionOverwrites.cache.map(overwrite => ({
                id: overwrite.id,
                allow: overwrite.allow.toArray(),
                deny: overwrite.deny.toArray(),
                type: overwrite.type
            }));
            client.settings.set(`${channel.id}:originalPerms`, originalPerms);
        }

        if (channel.type === ChannelType.GuildCategory) {
            // Lock/unlock all channels in the category
            const children = channel.children.cache;
            for (const [, child] of children) {
                await this.setChannelLock(child, isLocking);
            }
        }

        await this.setChannelLock(channel, isLocking);
    },

    async setChannelLock(channel, isLocking) {
        const perms = {
            SendMessages: !isLocking,
            AddReactions: !isLocking,
            CreatePublicThreads: !isLocking,
            CreatePrivateThreads: !isLocking,
            SendMessagesInThreads: !isLocking
        };

        if (channel.type === ChannelType.GuildVoice) {
            perms.Connect = !isLocking;
            perms.Speak = !isLocking;
        }

        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, perms);

        // If unlocking, restore original permissions if they exist
        if (!isLocking) {
            const originalPerms = client.settings.get(`${channel.id}:originalPerms`);
            if (originalPerms) {
                for (const perm of originalPerms) {
                    await channel.permissionOverwrites.edit(perm.id, {
                        allow: perm.allow,
                        deny: perm.deny
                    });
                }
                client.settings.delete(`${channel.id}:originalPerms`);
            }
        }
    }
}; 