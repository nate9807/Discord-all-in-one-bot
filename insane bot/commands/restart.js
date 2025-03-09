const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Reloads all bot commands, events, and systems (Owner only)'),
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
      .setTitle('Bot Reload')
      .setDescription('🔄 Reloading bot systems...')
      .setColor('#FFA500')
      .setTimestamp();

    await interaction.reply({ embeds: [restartEmbed] });

    try {
      // Save current settings if any exist
      if (client.settings && client.settings.size > 0) {
        try {
          const settingsFile = process.env.ABSOLUTE_SETTINGS_PATH;
          if (!settingsFile) {
            console.error('ABSOLUTE_SETTINGS_PATH not defined in environment variables');
          } else {
            // Ensure the directory exists
            const settingsDir = path.dirname(settingsFile);
            if (!fs.existsSync(settingsDir)) {
              fs.mkdirSync(settingsDir, { recursive: true });
            }

            // Convert settings to JSON and save
            const settingsData = {};
            for (const [key, value] of client.settings.entries()) {
              settingsData[key] = value;
            }
            fs.writeFileSync(settingsFile, JSON.stringify(settingsData, null, 2));
            console.log('Settings saved successfully');
          }
        } catch (error) {
          console.error('Error saving settings:', error);
        }
      }

      // Clear collections
      client.commands.clear();
      client.cooldowns.clear();
      client.removeAllListeners();

      // Save music state if it exists
      let musicStates = [];
      if (client.music && client.music.players) {
        try {
          musicStates = Array.from(client.music.players.values()).map(player => ({
            guildId: player.guildId,
            queue: player.queue,
            current: player.queue.current,
            position: player.position,
            volume: player.volume,
            paused: player.paused
          }));
        } catch (error) {
          console.error('Error saving music states:', error);
        }
      }

      // Reload commands
      const commandsPath = path.join(__dirname, '../commands');
      const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

      for (const file of commandFiles) {
        try {
          delete require.cache[require.resolve(path.join(commandsPath, file))];
          const command = require(path.join(commandsPath, file));
          if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            console.log(`Reloaded command: ${command.data.name}`);
          }
        } catch (error) {
          console.error(`Error reloading command ${file}:`, error);
        }
      }

      // Reload events
      const eventsPath = path.join(__dirname, '../events');
      const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

      for (const file of eventFiles) {
        try {
          delete require.cache[require.resolve(path.join(eventsPath, file))];
          const event = require(path.join(eventsPath, file));
          if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
          } else {
            client.on(event.name, (...args) => event.execute(...args, client));
          }
          console.log(`Reloaded event: ${event.name}`);
        } catch (error) {
          console.error(`Error reloading event ${file}:`, error);
        }
      }

      // Reload utils
      const utilsPath = path.join(__dirname, '../utils');
      if (fs.existsSync(utilsPath)) {
        const utilFiles = fs.readdirSync(utilsPath).filter(file => file.endsWith('.js'));
        for (const file of utilFiles) {
          try {
            delete require.cache[require.resolve(path.join(utilsPath, file))];
            console.log(`Reloaded utility: ${file}`);
          } catch (error) {
            console.error(`Error reloading utility ${file}:`, error);
          }
        }
      }

      // Reload music system if it exists
      if (client.music) {
        try {
          delete require.cache[require.resolve('../utils/music.js')];
          const MusicManager = require('../utils/music.js');
          client.music = new MusicManager(client);

          // Restore player states
          if (musicStates.length > 0) {
            for (const state of musicStates) {
              try {
                const player = client.music.players.get(state.guildId);
                if (player) {
                  player.queue = state.queue;
                  player.position = state.position;
                  player.volume = state.volume;
                  if (state.current) {
                    player.play(state.current);
                    if (state.paused) player.pause();
                  }
                }
              } catch (error) {
                console.error(`Error restoring music state for guild ${state.guildId}:`, error);
              }
            }
          }
          console.log('Music system reloaded');
        } catch (error) {
          console.error('Error reloading music system:', error);
        }
      }

      const successEmbed = new EmbedBuilder()
        .setTitle('Bot Reload')
        .setDescription('✅ All systems have been successfully reloaded!')
        .addFields([
          { name: 'Commands', value: '✅ Reloaded', inline: true },
          { name: 'Events', value: '✅ Reloaded', inline: true },
          { name: 'Utils', value: '✅ Reloaded', inline: true },
          { name: 'Music System', value: client.music ? '✅ Reloaded' : '➖ Not Present', inline: true }
        ])
        .setColor('#00FF00')
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
    } catch (error) {
      console.error('Reload failed:', error);
      const errorEmbed = new EmbedBuilder()
        .setTitle('Reload Failed')
        .setDescription('❌ An error occurred while reloading: ' + error.message)
        .setColor('#FF0000')
        .setTimestamp();
      
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};