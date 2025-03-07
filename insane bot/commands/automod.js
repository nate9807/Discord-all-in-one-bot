const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setautomod')
    .setDescription('Configure automod settings.')
    .addBooleanOption(option => 
      option.setName('enable')
        .setDescription('Enable or disable automod')
        .setRequired(true)
    )
    .addStringOption(option => 
      option.setName('badwords')
        .setDescription('Comma-separated list of bad words (e.g., word1,word2)')
        .setRequired(false)
    ),
  cooldown: 5,
  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'You need Administrator permissions!', ephemeral: true });
    }

    await interaction.deferReply();

    const enable = interaction.options.getBoolean('enable');
    const badWordsInput = interaction.options.getString('badwords');
    const badWords = badWordsInput ? badWordsInput.split(',').map(word => word.trim().toLowerCase()) : client.settings.get(`${interaction.guild.id}:badwords`) || [];

    // Update client.settings
    client.settings.set(`${interaction.guild.id}:automod`, enable);
    if (badWords.length > 0) client.settings.set(`${interaction.guild.id}:badwords`, badWords);
    fs.writeFileSync(path.join(__dirname, '../settings.json'), JSON.stringify(Object.fromEntries(client.settings), null, 2));

    // Log bad words to badwords.json
    const badWordsLogFile = path.join(__dirname, '../badwords.json');
    let badWordsLog = {};

    // Load existing badwords.json if it exists
    if (fs.existsSync(badWordsLogFile)) {
      badWordsLog = JSON.parse(fs.readFileSync(badWordsLogFile, 'utf8'));
    }

    // Initialize guild entry if not present
    if (!badWordsLog[interaction.guild.id]) {
      badWordsLog[interaction.guild.id] = [];
    }

    // Log new bad words with timestamp if provided
    if (badWordsInput && badWords.length > 0) {
      badWordsLog[interaction.guild.id].push({
        timestamp: new Date().toISOString(),
        badWords: badWords,
        setBy: interaction.user.tag,
      });
      fs.writeFileSync(badWordsLogFile, JSON.stringify(badWordsLog, null, 2));
    }

    const embed = new EmbedBuilder()
      .setTitle('Automod Settings Updated')
      .setDescription(`**Enabled:** ${enable ? 'Yes' : 'No'}\n**Bad Words:** ${badWords.length > 0 ? badWords.join(', ') : 'None set'}`)
      .setColor('#00FF00')
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  },
};