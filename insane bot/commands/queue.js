const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { getVoiceConnection } = require('@discordjs/voice');
const { formatDuration } = require('./play.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current music queue.')
    .addIntegerOption(option => 
      option.setName('page')
        .setDescription('Page number to view')
        .setMinValue(1)),
  cooldown: 3,
  async execute(interaction, client) {
    const guildId = interaction.guild.id;
    const queue = client.queues.get(guildId);

    try {
      if (!queue || !queue.songs.length) {
        const connection = getVoiceConnection(guildId);
        if (connection) {
          try {
            connection.destroy();
            client.queues.delete(guildId);
            logger.music(`Bot left voice channel in guild ${guildId} due to empty queue`);
            return interaction.reply({ content: 'The queue is empty! I have left the voice channel.', ephemeral: true });
          } catch (error) {
            logger.error(`Error leaving voice channel in guild ${guildId}:`, error);
            return interaction.reply({ content: 'The queue is empty, but I failed to leave the voice channel.', ephemeral: true });
          }
        }
        return interaction.reply({ content: 'The queue is empty!', ephemeral: true });
      }

      const songsPerPage = 10;
      const page = (interaction.options.getInteger('page') || 1) - 1;
      const totalPages = Math.ceil(queue.songs.length / songsPerPage);

      if (page >= totalPages) {
        logger.warn(`Invalid page request: ${page + 1}/${totalPages} for guild ${guildId}`);
        return interaction.reply({ 
          content: `Invalid page number. Please choose a page between 1 and ${totalPages}.`, 
          ephemeral: true 
        });
      }

      logger.info(`Displaying queue page ${page + 1}/${totalPages} for guild ${guildId} requested by ${interaction.user.tag}`);

      const currentSong = queue.songs[0];
      const upcomingSongs = queue.songs.slice(1);
      
      let description = `**Now Playing:**\n`;
      description += `**${currentSong.title}** by ${currentSong.author}\n`;
      description += `Duration: ${currentSong.isLive ? 'LIVE' : formatDuration(currentSong.duration)}\n`;
      description += `Requested by: ${currentSong.requestedBy || 'Unknown'}\n\n`;

      if (upcomingSongs.length > 0) {
        description += '**Up Next:**\n';
        const start = page * songsPerPage;
        const end = Math.min(start + songsPerPage, upcomingSongs.length);
        
        description += upcomingSongs
          .slice(start, end)
          .map((song, index) => {
            const position = start + index + 1;
            const duration = song.isLive ? 'LIVE' : formatDuration(song.duration);
            return `${position}. **${song.title}** by ${song.author} (${duration}) • Requested by: ${song.requestedBy || 'Unknown'}`;
          })
          .join('\n');
      }

      const totalDuration = queue.songs.reduce((acc, song) => {
        return acc + (song.isLive ? 0 : song.duration);
      }, 0);

      const liveStreams = queue.songs.filter(song => song.isLive).length;

      const embed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('Music Queue')
        .setDescription(description)
        .addFields(
          { 
            name: 'Queue Info', 
            value: `${queue.songs.length} songs in queue\n` +
                  `${liveStreams} live streams\n` +
                  `Total duration: ${formatDuration(totalDuration)}`, 
            inline: true 
          },
          { 
            name: 'Settings', 
            value: `Volume: ${Math.round(queue.volume * 100)}%\n` +
                  `Loop: ${queue.repeatMode}\n` +
                  `Effects: ${Object.entries(queue.effects)
                    .filter(([, enabled]) => enabled)
                    .map(([effect]) => effect)
                    .join(', ') || 'None'}`,
            inline: true 
          }
        )
        .setFooter({ 
          text: `Page ${page + 1}/${totalPages} • ${upcomingSongs.length} songs remaining • Use /queue <page> to view more` 
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error(`Queue command error in guild ${guildId}:`, error);
      await interaction.reply({ 
        content: 'An error occurred while displaying the queue. Please try again.',
        ephemeral: true 
      });
    }
  },
};