const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all commands.'),
  cooldown: 3,
  async execute(interaction, client) {
    const embed = new EmbedBuilder()
      .setTitle('MizMix Bot Commands')
      .setDescription('Here are all available commands:')
      .setColor('#00FFFF')
      .addFields(
        client.commands.map(cmd => ({
          name: `/${cmd.data.name}`,
          value: `${cmd.data.description} (Cooldown: ${cmd.cooldown || 3}s)`,
          inline: true,
        }))
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};