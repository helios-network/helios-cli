const { BackupServer } = require('../services/BackupServer');
const { DaemonManager } = require('../services/DaemonManager');

module.exports = async function backupServer({ argv, command }) {
  return new Promise((resolve, reject) => {
    try {
      const isDaemon = argv.daemon || argv.d || false;
      
      let port = parseInt(argv.port || argv.p || process.env.PORT || '3000');
      if (port <= 0 || port > 65535) {
        port = parseInt(process.env.PORT || '3000');
      }

      let maxDownloadRate = 1024 * 1024;
      if (argv.rate || argv.r) {
        const rate = parseInt(argv.rate || argv.r || '1');
        if (rate > 0) {
          maxDownloadRate = rate * 1024 * 1024;
        }
      }

      let host = argv.host || argv.H || process.env.HOST || 'localhost';

      if (isDaemon) {
        console.log('[INFO] Starting server in daemon mode...');
        console.log(`[INFO] Port: ${port}, Rate: ${maxDownloadRate / 1024 / 1024} MB/s, Host: ${host}`);
        DaemonManager.runDaemon(port, maxDownloadRate, host);
        resolve();
      } else {
        console.log('[INFO] Starting server in foreground mode...');
        const server = new BackupServer(port, maxDownloadRate, host);
        server.start();
        resolve();
      }
    } catch (error) {
      reject(error);
    }
  });
};

