const axios = require('axios');
const logger = require('./logger');

let cache = {};

async function checkLiveStatus(username) {
  if (cache[username]?.time > Date.now() - 300000) return cache[username].isLive;

  try {
    const response = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${process.env.TWITCH_TOKEN}`,
      },
    });
    const isLive = response.data.data.length > 0;
    cache[username] = { isLive, time: Date.now() };
    return isLive;
  } catch (error) {
    logger.error(`Twitch API error for ${username}: ${error.message}`);
    return false;
  }
}

module.exports = { checkLiveStatus };