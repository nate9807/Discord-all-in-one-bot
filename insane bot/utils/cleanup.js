const fs = require('fs').promises;
const path = require('path');

// Log cleanup utility
async function cleanupLogs(options = {}) {
  const {
    logDir = path.join(__dirname, '../data/logs'),
    maxAgeDays = 7,
    dryRun = false
  } = options;
  
  try {
    // Get current time
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    
    // List all files in the log directory
    const files = await fs.readdir(logDir);
    
    // Track statistics
    let totalBytes = 0;
    let deletedFiles = 0;
    
    for (const file of files) {
      const filePath = path.join(logDir, file);
      
      try {
        // Get file stats
        const stats = await fs.stat(filePath);
        
        // Check if file is old enough to delete
        const fileAge = now - stats.mtime.getTime();
        
        if (fileAge > maxAgeMs && stats.isFile()) {
          // Log file is older than maxAgeDays
          totalBytes += stats.size;
          deletedFiles++;
          
          if (!dryRun) {
            await fs.unlink(filePath);
            console.log(`Deleted old log file: ${file} (${Math.round(stats.size / 1024)} KB)`);
          } else {
            console.log(`Would delete: ${file} (${Math.round(stats.size / 1024)} KB)`);
          }
        }
      } catch (err) {
        console.error(`Error processing file ${file}:`, err.message);
      }
    }
    
    // Report results
    if (dryRun) {
      console.log(`Dry run completed. Would delete ${deletedFiles} files (${Math.round(totalBytes / 1024 / 1024)} MB)`);
    } else {
      console.log(`Cleanup completed. Deleted ${deletedFiles} files (${Math.round(totalBytes / 1024 / 1024)} MB)`);
    }
    
    return { deletedFiles, totalBytes };
  } catch (err) {
    console.error('Log cleanup failed:', err.message);
    throw err;
  }
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const days = args.find(arg => arg.startsWith('--days='))?.split('=')[1];
  
  cleanupLogs({
    maxAgeDays: days ? parseInt(days) : 7,
    dryRun
  }).catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  });
}

module.exports = cleanupLogs; 