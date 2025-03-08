const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
require('dotenv').config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Restarts the bot (Owner only)'),
  cooldown: 5,
  async execute(interaction, client) {
    const ownerId = process.env.OWNERID;

    if (interaction.user.id !== ownerId) {
      return interaction.reply({ 
        content: 'Only the bot owner can use this command!', 
        ephemeral: true 
      });
    }

    const restartEmbed = new EmbedBuilder()
      .setTitle('Bot Restart')
      .setDescription('Bot is restarting...')
      .setColor('#FFA500')
      .setTimestamp();

    await interaction.reply({ embeds: [restartEmbed] });

    try {
      console.log('Bot restarting by owner command...');

      if (client.shard) {
        // Save settings across all shards
        await client.shard.broadcastEval(async (c) => {
          console.log(`Shard ${c.shard.ids[0]} preparing for restart...`);
          if (c.settings.size > 0) {
            const settingsFile = process.env.ABSOLUTE_SETTINGS_PATH;
            require('fs').writeFileSync(settingsFile, JSON.stringify(Object.fromEntries(c.settings), null, 2));
          }
          // Destroy the client to force a restart
          await c.destroy();
          console.log(`Shard ${c.shard.ids[0]} destroyed, expecting respawn...`);
          return true;
        });

        const restartingEmbed = new EmbedBuilder()
          .setTitle('Bot Restart')
          .setDescription('All shards are restarting now...')
          .setColor('#FFA500')
          .setTimestamp();
        await interaction.editReply({ embeds: [restartingEmbed] });

        // Fallback: Send restart signal (optional)
        console.log('Sending restart signal to ShardingManager as fallback...');
        process.send({ type: 'restart' });
      } else {
        console.log('No sharding detected, exiting process...');
        process.exit(0);
      }

    } catch (error) {
      console.error('Restart failed:', error);
      const errorEmbed = new EmbedBuilder()
        .setTitle('Restart Failed')
        .setDescription('An error occurred while restarting: ' + error.message)
        .setColor('#FF0000')
        .setTimestamp();
      
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};