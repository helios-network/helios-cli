const fs = require('fs');
const path = require('path');
const os = require('os');

class BackupPathResolver {
  static getBackupPath() {
    try {
      const basePwd = fs.existsSync(path.join(os.homedir(), '.helios-cli', 'pwd'))
        ? fs.readFileSync(path.join(os.homedir(), '.helios-cli', 'pwd'), 'utf8').trim()
        : os.homedir();
      
      if (!basePwd || basePwd.length > 1024) {
        throw new Error('Invalid base path');
      }
      
      const primaryPath = path.join(basePwd, 'data', 'node1', '.heliades', 'backups');
      const defaultPath = path.join(basePwd, '.heliades', 'backups');
      
      const resolvedPrimary = path.resolve(primaryPath);
      const resolvedDefault = path.resolve(defaultPath);
      
      if (resolvedPrimary.length > 2048 || resolvedDefault.length > 2048) {
        throw new Error('Path too long');
      }
      
      return fs.existsSync(primaryPath) ? primaryPath : defaultPath;
    } catch (error) {
      console.error('[ERROR] Failed to resolve backup path:', error);
      return path.join(os.homedir(), '.heliades', 'backups');
    }
  }
}

module.exports = { BackupPathResolver };

