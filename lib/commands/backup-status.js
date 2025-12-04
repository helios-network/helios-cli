const fs = require('fs');
const path = require('path');

module.exports = async function backupStatus({ argv, command }) {
  return new Promise((resolve, reject) => {
    try {
      const pidFile = path.join(process.cwd(), 'helios-backups.pid');
      
      if (fs.existsSync(pidFile)) {
        const pid = fs.readFileSync(pidFile, 'utf8').trim();
        try {
          process.kill(parseInt(pid), 0);
          console.log(`[INFO] Daemon is running with PID: ${pid}`);
        } catch (error) {
          console.log('[INFO] Daemon is not running');
          fs.unlinkSync(pidFile);
        }
      } else {
        console.log('[INFO] Daemon is not running');
      }
      resolve();
    } catch (error) {
      reject(error);
    }
  });
};

