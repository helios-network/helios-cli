const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { Throttle } = require('stream-throttle');
const { BackupPathResolver } = require('../utils/BackupPathResolver');
const { snapshotSecurity } = require('../security/SnapshotSecurity');

class BackupServer {
  constructor(port = 3000, maxDownloadRate = 1024 * 1024, host = 'localhost') {
    this.app = express();
    this.port = port;
    this.snapshotDir = BackupPathResolver.getBackupPath();
    this.maxDownloadRate = maxDownloadRate;
    this.host = host;
    this.security = snapshotSecurity;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.security.getMiddleware().forEach(middleware => {
      this.app.use(middleware);
    });
    this.app.use('/snapshots/:filename', rateLimit({
      windowMs: 60 * 1000,
      max: 10,
      standardHeaders: true,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => req.ip,
      handler: (req, res) => res.status(429).json({ 
        error: 'Too many download requests from this IP, please try again later.',
        retryAfter: 60
      })
    }));
  }

  setupRoutes() {
    this.app.get('/snapshots/:filename.header.json', (req, res) => {
      try {
        const fileName = path.basename(req.params.filename);
        
        if (!this.security.validateFilename(fileName)) {
          console.warn(`[SECURITY] Invalid filename: ${fileName} from ${req.ip}`);
          return res.status(400).json({ error: 'Invalid filename format.' });
        }

        if (!this.security.validateFileExtension(fileName)) {
          console.warn(`[SECURITY] Invalid extension: ${fileName} from ${req.ip}`);
          return res.status(400).json({ error: 'Invalid file type. Only backup files (.gz, .tar.gz) are allowed.' });
        }

        const filePath = path.join(this.snapshotDir, fileName);
        if (!this.security.validatePath(filePath, this.snapshotDir)) {
          console.warn(`[SECURITY] Path traversal: ${filePath} from ${req.ip}`);
          return res.status(400).json({ error: 'Invalid file path' });
        }

        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: 'Snapshot not found.' });
        }

        const stats = fs.statSync(filePath);
        const headerContent = {
          filename: this.security.sanitizeFilename(fileName),
          blockId: this.extractBlockId(fileName),
          uploadedAt: stats.mtime.toISOString(),
          description: this.generateDescription(fileName, this.extractBlockId(fileName)),
          downloadUrl: this.generateUrl(fileName),
          fileSize: stats.size,
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.json(headerContent);

      } catch (error) {
        console.error('[ERROR] Header route error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
      }
    });

    this.app.get('/snapshots/:filename', (req, res) => {
      try {
        const fileName = path.basename(req.params.filename);
        
        if (!this.security.validateFilename(fileName) || 
            !this.security.validateFileExtension(fileName) ||
            !this.security.validateMimeType(fileName)) {
          console.warn(`[SECURITY] Invalid file: ${fileName} from ${req.ip}`);
          return res.status(400).json({ error: 'Invalid file type or format.' });
        }

        const filePath = path.join(this.snapshotDir, fileName);
        if (!this.security.validatePath(filePath, this.snapshotDir) || !this.security.validateFile(filePath)) {
          console.warn(`[SECURITY] Invalid path or file: ${fileName} from ${req.ip}`);
          return res.status(404).json({ error: 'File not found or invalid' });
        }

        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: 'Snapshot not found.' });
        }

        const sanitizedFilename = this.security.sanitizeFilename(fileName);
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
        res.setHeader('Content-Type', this.security.getMimeType(fileName));
        Object.entries(this.security.getSecurityHeaders()).forEach(([key, value]) => {
          res.setHeader(key, value);
        });

        const throttle = new Throttle({ rate: this.maxDownloadRate });
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(throttle).pipe(res);

        fileStream.on('error', (err) => {
          console.error('[ERROR] File read error:', err);
          if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
        });

        res.on('error', (err) => console.error('[ERROR] Response error:', err));

      } catch (error) {
        console.error('[ERROR] Route error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
      }
    });

    this.app.get('/health', (req, res) => {
      try {
        const packageJson = require('../../package.json');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: packageJson.version || '1.0.0',
          environment: process.env.NODE_ENV || 'development'
        });
      } catch (error) {
        console.error('[ERROR] Health check error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
      }
    });

    this.app.get('/snapshots', (req, res) => {
      try {
        if (!fs.existsSync(this.snapshotDir)) {
          console.info(`[INFO] Backup directory not found: ${this.snapshotDir} requested by ${req.ip}`);
          return res.json({
            snapshots: [],
            totalCount: 0,
          });
        }

        const files = fs.readdirSync(this.snapshotDir)
          .filter(file => this.security.validateFileExtension(file))
          .sort((a, b) => this.extractBlockId(b) - this.extractBlockId(a));

        const snapshots = files.map(file => {
          const filePath = path.join(this.snapshotDir, file);
          const stats = fs.statSync(filePath);
          const blockId = this.extractBlockId(file);
          return {
            filename: file,
            blockId: blockId,
            uploadedAt: stats.mtime.toISOString(),
            description: this.generateDescription(file, blockId),
            downloadUrl: this.generateUrl(file),
            headerUrl: this.generateUrl(file) + '.header.json',
            fileSize: stats.size,
          };
        });

        res.setHeader('Content-Type', 'application/json');
        Object.entries(this.security.getSecurityHeaders()).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
        res.json({ snapshots, totalCount: snapshots.length });

      } catch (error) {
        console.error('[ERROR] List route error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
      }
    });

    this.app.use('*', (req, res) => {
      console.warn(`[SECURITY] 404 - Route not found: ${req.method} ${req.originalUrl} from ${req.ip}`);
      res.status(404).json({ error: 'Route not found' });
    });

    this.app.use((err, req, res, next) => {
      const errorMessage = process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message;
      res.status(500).json({ error: errorMessage, timestamp: new Date().toISOString() });
    });
  }

  start() {
    const server = this.app.listen(this.port, '0.0.0.0', () => {
      console.log(`[INFO] Helios Backups server running on http://${this.host === 'localhost' ? 'localhost' : this.host}:${this.port}`);
      console.log(`[INFO] Serving backups from: ${this.snapshotDir}`);
      console.log(`[INFO] Max download rate: ${this.maxDownloadRate / 1024 / 1024} MB/s`);
    });

    server.timeout = 300000;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    let isShuttingDown = false;
    const gracefulShutdown = (signal) => {
      if (isShuttingDown) process.exit(1);
      isShuttingDown = true;
      this.security.destroy();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }

  generateUrl(filename) {
    const protocol = this.host === 'localhost' ? 'http' : 'https';
    const port = this.host === 'localhost' ? `:${this.port}` : '';
    return `${protocol}://${this.host}${port}/snapshots/${this.security.sanitizeFilename(filename)}`;
  }

  extractBlockId(filename) {
    const match = filename.match(/snapshot_(\d+)_/);
    return match ? parseInt(match[1], 10) : 0;
  }

  generateDescription(filename, blockId) {
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/);
    if (dateMatch) {
      return `Helios Node Backup - Block ${blockId} - ${dateMatch[1]} ${dateMatch[2]}`;
    }
    return `Helios Node Backup - Block ${blockId} - ${filename}`;
  }
}

module.exports = { BackupServer };
