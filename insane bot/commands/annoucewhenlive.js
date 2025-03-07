const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const twitch = require('../utils/twitch');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announcewhenlive')
    .setDescription('Set up Twitch live announcements.')
    .addStringOption(option => option.setName('twitchusername').setDescription('Twitch username').setRequired(true))
    .addChannelOption(option => option.setName('channel').setDescription('Announcement channel').setRequired(true)),
  cooldown: 10,
  async execute(interaction, client) {
    const twitchUsername = interaction.options.getString('twitchusername');
    const channel = interaction.options.getChannel('channel');

    client.settings.set(`${interaction.guild.id}:twitch`, { username: twitchUsername, channelId: channel.id });

    const embed = new EmbedBuilder()
      .setTitle('Twitch Announcement Set')
      .setDescription(`Announcements for **${twitchUsername}** will be sent to ${channel}.`)
      .setColor('#9146FF')
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });

    if (!client.twitchInterval) {
      client.twitchInterval = setInterval(async () => {
        for (const [key, value] of client.settings.entries()) {
          if (key.endsWith(':twitch')) {
            const isLive = await twitch.checkLiveStatus(value.username);
            if (isLive) {
              const announceChannel = client.channels.cache.get(value.channelId);
              if (announceChannel) {
                const liveEmbed = new EmbedBuilder()
                  .setTitle('🔴 Live Now on Twitch!')
                  .setDescription(`**${value.username}** is live! Watch now: [Twitch](https://twitch.tv/${value.username})`)
                  .setColor('#9146FF')
                  .setTimestamp();
                announceChannel.send({ embeds: [liveEmbed] });
              }
            }
          }
        }
      }, 300000); // 5 minutes
    }
  },
};