const { DaemonManager } = require('../services/DaemonManager');

module.exports = async function backupStop({ argv, command }) {
  return new Promise((resolve, reject) => {
    try {
      console.log('[INFO] Stopping daemon...');
      DaemonManager.stopDaemon();
      resolve();
    } catch (error) {
      reject(error);
    }
  });
};

