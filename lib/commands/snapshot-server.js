const { BackupServer } = require('../services/BackupServer');
const { DaemonManager } = require('../services/DaemonManager');
const fs = require('fs');
const path = require('path');

module.exports = async function snapshotServer({ argv, command }) {
  return new Promise((resolve, reject) => {
    try {
      if (argv.help || argv.h) {
        showHelp();
        resolve();
        return;
      }
      
      const subCommand = argv._[1];
      
      if (!subCommand) {
        showHelp();
        resolve();
        return;
      }
      
      switch (subCommand) {
        case 'serve':
          handleServe(argv, resolve, reject);
          break;
        case 'stop':
          handleStop(resolve, reject);
          break;
        case 'status':
          handleStatus(resolve, reject);
          break;
        case 'help':
        case '--help':
        case '-h':
          showHelp();
          resolve();
          break;
        default:
          console.error(`Unknown subcommand: ${subCommand}`);
          console.log('');
          showHelp();
          reject(new Error(`Unknown subcommand: ${subCommand}`));
          break;
      }
    } catch (error) {
      reject(error);
    }
  });
};

function handleServe(argv, resolve, reject) {
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
    }
  } catch (error) {
    reject(error);
  }
}

function handleStop(resolve, reject) {
  try {
    console.log('[INFO] Stopping daemon...');
    DaemonManager.stopDaemon();
    resolve();
  } catch (error) {
    reject(error);
  }
}

function handleStatus(resolve, reject) {
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
}

function showHelp() {
  console.log('Helios Snapshot Server - Secure Backup File Server');
  console.log('');
  console.log('Usage: helios snapshot-server <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  serve              Start the backup server');
  console.log('  stop               Stop the daemon server');
  console.log('  status             Show daemon status');
  console.log('  help, --help, -h   Show this help message');
  console.log('');
  console.log('Options:');
  console.log('  -d, --daemon       Run in daemon mode');
  console.log('  -p, --port <port>  Set server port (default: 3000)');
  console.log('  -r, --rate <rate>  Set max download rate in MB/s (default: 1)');
  console.log('  -H, --host <host>  Set hostname for URLs (default: localhost)');
  console.log('');
  console.log('Examples:');
  console.log('  helios snapshot-server serve');
  console.log('  helios snapshot-server serve -d');
  console.log('  helios snapshot-server serve -p 8080 -r 5');
  console.log('  helios snapshot-server serve -H example.com');
  console.log('  helios snapshot-server serve -H example.com -p 443');
  console.log('  helios snapshot-server stop');
  console.log('  helios snapshot-server status');
  console.log('');
  console.log('Environment Variables:');
  console.log('  PORT               Server port (default: 3000)');
  console.log('  HOST               Server hostname (default: localhost)');
  console.log('  NODE_ENV           Environment mode (development/production)');
}

