const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete messages.')
    .addIntegerOption(option => 
      option.setName('amount')
        .setDescription('Number of messages (max 10000)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
    ),
  cooldown: 5,
  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({ content: 'You need Manage Messages permissions!', ephemeral: true });
    }

    const amount = interaction.options.getInteger('amount');
    
    // Defer reply since large purges might take time
    await interaction.deferReply({ ephemeral: true });

    try {
      let totalDeleted = 0;
      
      // If amount is less than 100, do a single delete
      if (amount <= 100) {
        const deleted = await interaction.channel.bulkDelete(amount, true);
        totalDeleted = deleted.size;
      } else {
        // For larger amounts, delete in batches of 100
        const batches = Math.ceil(amount / 100);
        
        for (let i = 0; i < batches && totalDeleted < amount; i++) {
          const messagesToDelete = Math.min(100, amount - totalDeleted);
          const deleted = await interaction.channel.bulkDelete(messagesToDelete, true);
          totalDeleted += deleted.size;
          
          // Small delay between batches to prevent rate limiting
          if (i < batches - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('Messages Purged')
        .setDescription(`Deleted ${totalDeleted} messages.\nRequested: ${amount}`)
        .setColor('#FF4500')
        .setTimestamp()
        .setFooter({ text: totalDeleted < amount ? 'Some messages couldn\'t be deleted (possibly older than 14 days)' : 'Purge completed' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error(error);
      const errorEmbed = new EmbedBuilder()
        .setTitle('Purge Error')
        .setDescription('An error occurred while purging messages.')
        .setColor('#FF0000')
        .setTimestamp();
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};