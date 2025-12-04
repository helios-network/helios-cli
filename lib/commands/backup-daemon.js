#!/usr/bin/env node

const { BackupServer } = require('../services/BackupServer');

async function startDaemon() {
  try {    
    const port = parseInt(process.env.PORT || '3000');
    const host = process.env.HOST || 'localhost';
    const maxDownloadRate = parseInt(process.env.MAX_DOWNLOAD_RATE || '1048576');
    
    const server = new BackupServer(port, maxDownloadRate, host);
    server.start();
    
    console.log(`[INFO] Daemon started successfully on port ${port}`);
    console.log(`[INFO] PID: ${process.pid}`);
    
    process.on('SIGTERM', () => {
      console.log('[INFO] SIGTERM received, shutting down gracefully');
      process.exit(0);
    });
    
    process.on('SIGINT', () => {
      console.log('[INFO] SIGINT received, shutting down gracefully');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('[ERROR] Failed to start daemon:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startDaemon();
}

module.exports = { startDaemon };

