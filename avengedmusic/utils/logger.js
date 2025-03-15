const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

// Create asyncronous versions of fs functions
const appendFile = promisify(fs.appendFile);
const stat = promisify(fs.stat);
const rename = promisify(fs.rename);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

// Track console output errors to avoid repeated failures
let consoleErrorCount = 0;
const MAX_CONSOLE_ERRORS = 3;
let skipConsoleOutput = false;
const CONSOLE_ERROR_RESET_INTERVAL = 60000; // 1 minute

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir);
    console.log(`Created data directory at ${dataDir}`);
  } catch (error) {
    console.error(`Failed to create data directory: ${error.message}`);
  }
}

// Create logs subdirectory in data
const logDir = path.join(dataDir, 'logs');
if (!fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir);
    console.log(`Created logs directory at ${logDir}`);
  } catch (error) {
    console.error(`Failed to create logs directory: ${error.message}`);
  }
}

// Create separate log files for different types of logs
const getLogFile = (type) => {
  const date = new Date().toISOString().split('T')[0];
  return path.join(logDir, `${date}-${type}.log`);
};

const logFiles = {
  info: getLogFile('info'),
  error: getLogFile('error'),
  warn: getLogFile('warn'),
  music: getLogFile('music'),
  messages: getLogFile('messages')
};

// Ensure all log files exist
Object.values(logFiles).forEach(file => {
  if (!fs.existsSync(file)) {
    try {
      fs.writeFileSync(file, ''); // Create empty file
      console.log(`Created log file: ${file}`);
    } catch (err) {
      console.error(`Failed to create log file ${file}: ${err.message}`);
    }
  }
});

// Maximum log file size (10MB)
const MAX_LOG_SIZE = 10 * 1024 * 1024;

// Write to log file with retries
const writeToLogFile = async (logFile, logMessage) => {
  try {
    await appendFile(logFile, logMessage);
    return true;
  } catch (error) {
    console.error(`Failed to write to log file ${logFile}: ${error.message}`);
    
    // Try synchronous write as fallback
    try {
      fs.appendFileSync(logFile, logMessage);
      return true;
    } catch (syncError) {
      console.error(`Failed synchronous write fallback: ${syncError.message}`);
      return false;
    }
  }
};

// Rotate log file if it gets too big
const rotateLogFile = async (logFile) => {
  try {
    if (fs.existsSync(logFile)) {
      const stats = await stat(logFile);
      if (stats.size > MAX_LOG_SIZE) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = `${logFile}.${timestamp}.old`;
        await rename(logFile, backupFile);
        await writeFile(logFile, '');
        console.log(`Rotated log file ${logFile} to ${backupFile}`);
      }
    }
  } catch (error) {
    console.error(`Failed to rotate log file: ${error.message}`);
  }
};

const log = async (level, type, ...args) => {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => {
    if (arg instanceof Error) {
      return arg.stack || arg.message;
    }
    return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg;
  }).join(' ');

  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  const logFile = logFiles[type] || logFiles.info;

  try {
    // Always try console first
    if (!skipConsoleOutput) {
      try {
        console.log(logMessage.trim());
      } catch (error) {
        consoleErrorCount++;
        if (consoleErrorCount >= MAX_CONSOLE_ERRORS) {
          skipConsoleOutput = true;
          console.error('Too many console errors, disabling console output');
        }
      }
    }
    
    // Check if we need to rotate the log file
    await rotateLogFile(logFile);
    
    // Write to file
    const success = await writeToLogFile(logFile, logMessage);
    if (!success) {
      console.error(`Failed to write to log file ${logFile}`);
    }
  } catch (error) {
    console.error(`Logging failed: ${error.message}`);
  }
};

// Synchronous version for critical errors
const logSync = (level, type, ...args) => {
  const timestamp = new Date().toISOString();
  const message = args.join(' ');
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  const logFile = logFiles[type] || logFiles.info;

  try {
    // Try console first
    if (!skipConsoleOutput) {
      try {
        console.log(logMessage.trim());
      } catch (e) {
        // Ignore console errors in sync logging
      }
    }
    
    // Try to write to file synchronously
    try {
      fs.appendFileSync(logFile, logMessage);
    } catch (e) {
      console.error(`Failed to write sync log: ${e.message}`);
    }
  } catch (e) {
    // Last resort error log
    console.error(`Critical logging failure: ${e.message}`);
  }
};

// Export the logging functions
module.exports = {
  info: (...args) => log('info', 'info', ...args),
  error: (...args) => log('error', 'error', ...args),
  warn: (...args) => log('warn', 'warn', ...args),
  music: (...args) => log('music', 'music', ...args),
  messages: (...args) => log('msg', 'messages', ...args),
  errorSync: (...args) => logSync('error', 'error', ...args)
};