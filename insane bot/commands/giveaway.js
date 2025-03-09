const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const ms = require('ms');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Create and manage giveaways')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start a new giveaway')
                .addStringOption(option =>
                    option.setName('prize')
                        .setDescription('What is being given away')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('duration')
                        .setDescription('Duration of the giveaway (e.g., 1h, 1d, 1w)')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('winners')
                        .setDescription('Number of winners')
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('requirements')
                        .setDescription('Requirements to enter (optional)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('end')
                .setDescription('End a giveaway early')
                .addStringOption(option =>
                    option.setName('message_id')
                        .setDescription('Message ID of the giveaway')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reroll')
                .setDescription('Reroll a giveaway winner')
                .addStringOption(option =>
                    option.setName('message_id')
                        .setDescription('Message ID of the giveaway')
                        .setRequired(true))),
    cooldown: 5,

    async execute(interaction, client) {
        try {
            const subcommand = interaction.options.getSubcommand();

            switch (subcommand) {
                case 'start':
                    await this.handleStart(interaction, client);
                    break;
                case 'end':
                    await this.handleEnd(interaction, client);
                    break;
                case 'reroll':
                    await this.handleReroll(interaction, client);
                    break;
            }
        } catch (error) {
            logger.error('Error in giveaway command:', error);
            await interaction.reply({
                content: 'There was an error executing the giveaway command.',
                ephemeral: true
            });
        }
    },

    async handleStart(interaction, client) {
        const prize = interaction.options.getString('prize');
        const duration = interaction.options.getString('duration');
        const winnersCount = interaction.options.getInteger('winners');
        const requirements = interaction.options.getString('requirements') || 'No special requirements';

        const ms_duration = ms(duration);
        if (!ms_duration) {
            return interaction.reply({
                content: 'Please provide a valid duration (e.g., 1h, 1d, 1w)',
                ephemeral: true
            });
        }

        const endTime = Date.now() + ms_duration;
        const giveawayEmbed = new EmbedBuilder()
            .setTitle('🎉 GIVEAWAY 🎉')
            .setDescription(`
                **Prize:** ${prize}
                **Winners:** ${winnersCount}
                **Requirements:** ${requirements}
                **Ends:** <t:${Math.floor(endTime / 1000)}:R>
                
                React with 🎉 to enter!
            `)
            .setColor('#FF00FF')
            .setTimestamp(endTime);

        const message = await interaction.channel.send({ embeds: [giveawayEmbed] });
        await message.react('🎉');

        // Store giveaway data
        const giveawayData = {
            messageId: message.id,
            channelId: message.channel.id,
            guildId: interaction.guild.id,
            prize,
            winnersCount,
            endTime,
            ended: false,
            hostId: interaction.user.id
        };

        // Save to client settings
        const giveaways = client.settings.get(`${interaction.guild.id}:giveaways`) || [];
        giveaways.push(giveawayData);
        client.settings.set(`${interaction.guild.id}:giveaways`, giveaways);

        await interaction.reply({
            content: `Giveaway started! It will end ${duration} from now.`,
            ephemeral: true
        });

        // Set timeout to end giveaway
        setTimeout(() => this.endGiveaway(client, giveawayData), ms_duration);
    },

    async handleEnd(interaction, client) {
        const messageId = interaction.options.getString('message_id');
        const giveaways = client.settings.get(`${interaction.guild.id}:giveaways`) || [];
        const giveaway = giveaways.find(g => g.messageId === messageId && !g.ended);

        if (!giveaway) {
            return interaction.reply({
                content: 'Could not find an active giveaway with that message ID.',
                ephemeral: true
            });
        }

        await this.endGiveaway(client, giveaway);
        await interaction.reply({
            content: 'Giveaway ended successfully!',
            ephemeral: true
        });
    },

    async handleReroll(interaction, client) {
        const messageId = interaction.options.getString('message_id');
        const giveaways = client.settings.get(`${interaction.guild.id}:giveaways`) || [];
        const giveaway = giveaways.find(g => g.messageId === messageId && g.ended);

        if (!giveaway) {
            return interaction.reply({
                content: 'Could not find an ended giveaway with that message ID.',
                ephemeral: true
            });
        }

        try {
            const channel = await interaction.guild.channels.fetch(giveaway.channelId);
            const message = await channel.messages.fetch(giveaway.messageId);
            const reaction = message.reactions.cache.get('🎉');
            const users = await reaction.users.fetch();
            const validUsers = users.filter(user => !user.bot);

            if (validUsers.size === 0) {
                return interaction.reply({
                    content: 'No valid entries for the giveaway!',
                    ephemeral: true
                });
            }

            const winner = validUsers.random();
            await channel.send(`🎉 Congratulations! The new winner is ${winner}! (Rerolled from previous giveaway)`);
            await interaction.reply({
                content: 'Successfully rerolled the giveaway winner!',
                ephemeral: true
            });
        } catch (error) {
            logger.error('Error rerolling giveaway:', error);
            await interaction.reply({
                content: 'There was an error rerolling the giveaway.',
                ephemeral: true
            });
        }
    },

    async endGiveaway(client, giveaway) {
        try {
            const guild = await client.guilds.fetch(giveaway.guildId);
            const channel = await guild.channels.fetch(giveaway.channelId);
            const message = await channel.messages.fetch(giveaway.messageId);
            const reaction = message.reactions.cache.get('🎉');
            const users = await reaction.users.fetch();
            const validUsers = users.filter(user => !user.bot);

            // Update giveaway status
            const giveaways = client.settings.get(`${giveaway.guildId}:giveaways`) || [];
            const giveawayIndex = giveaways.findIndex(g => g.messageId === giveaway.messageId);
            if (giveawayIndex !== -1) {
                giveaways[giveawayIndex].ended = true;
                client.settings.set(`${giveaway.guildId}:giveaways`, giveaways);
            }

            if (validUsers.size === 0) {
                await channel.send('No valid entries for the giveaway! 😢');
                return;
            }

            const winners = [];
            for (let i = 0; i < Math.min(giveaway.winnersCount, validUsers.size); i++) {
                let winner;
                do {
                    winner = validUsers.random();
                } while (winners.includes(winner));
                winners.push(winner);
            }

            const winnerMentions = winners.map(w => w.toString()).join(', ');
            const endEmbed = new EmbedBuilder()
                .setTitle('🎉 GIVEAWAY ENDED 🎉')
                .setDescription(`
                    **Prize:** ${giveaway.prize}
                    **Winners:** ${winnerMentions}
                    **Total Entries:** ${validUsers.size}
                `)
                .setColor('#00FF00')
                .setTimestamp();

            await message.edit({ embeds: [endEmbed] });
            await channel.send(`Congratulations ${winnerMentions}! You won **${giveaway.prize}**!`);
        } catch (error) {
            logger.error('Error ending giveaway:', error);
        }
    }
}; 