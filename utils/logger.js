const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

const logFile = path.join(logDir, `${new Date().toISOString().split('T')[0]}.log`);

const log = (level, color, ...args) => {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  console.log(color(logMessage.trim()));
  fs.appendFileSync(logFile, logMessage);
};

module.exports = {
  info: (...args) => log('info', chalk.white, ...args),
  error: (...args) => log('error', chalk.red, ...args),
  warn: (...args) => log('warn', chalk.yellow, ...args),
};