const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

class SnapshotSecurity {
  constructor() {
    this.config = {
      ALLOWED_EXTENSIONS: ['.gz', '.tar.gz'],
      MAX_FILENAME_LENGTH: 255,
      FILENAME_REGEX: /^snapshot_\d+_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.(gz|tar\.gz|header\.json)$/,
      ALLOWED_MIME_TYPES: ['application/gzip', 'application/octet-stream', 'application/json'],
      MAX_CONCURRENT_CONNECTIONS: 100,
      MAX_SLOW_CONNECTIONS: 50,
      SLOW_LORIS_BLOCK_DURATION: 600000,
      SLOW_LORIS_GRACE_PERIOD: 30000,
      REQUEST_TIMEOUT: 60000,
      RESPONSE_TIMEOUT: 120000,
      CONNECTION_TIMEOUT: 300000,
      DOWNLOAD_SLOW_LORIS: {
        MAX_SLOW_DOWNLOADS: 5,
        MIN_TRANSFER_RATE: 256,
        MAX_DOWNLOAD_DURATION: 3600000,
        SLOW_DOWNLOAD_THRESHOLD: 128,
        BLOCK_DURATION: 300000,
      }
    };

    this.connectionMap = new Map();
    this.downloadMap = new Map();
    this.cleanupInterval = setInterval(() => this.cleanupExpiredConnections(), 30000);
  }

  getMiddleware() {
    return [
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: [],
          },
        },
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
        noSniff: true,
        xssFilter: true,
        hidePoweredBy: true,
        frameguard: { action: 'deny' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
      }),
      this.getSlowLorisMiddleware(),
      morgan('combined', {
        skip: (req, res) => res.statusCode < 400,
        stream: { write: (message) => console.log(`[SECURITY] ${message.trim()}`) }
      }),
      rateLimit({
        windowMs: 60 * 1000,
        max: 200,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.ip,
        skip: (req) => req.path.startsWith('/snapshots/') && req.method === 'GET',
        handler: (req, res) => res.status(429).json({ 
          error: 'Too many requests from this IP, please try again later.',
          retryAfter: 60
        })
      }),
      express.json({ limit: '10kb' }),
      express.urlencoded({ extended: true, limit: '10kb' }),
      this.getRequestValidationMiddleware()
    ];
  }

  getSlowLorisMiddleware() {
    return (req, res, next) => {
      const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
      
      if (req.path.startsWith('/snapshots/') && req.method === 'GET') {
        return this.handleDownloadProtection(req, res, next, clientIp);
      }
      
      if (this.isIpBlocked(clientIp)) {
        return res.status(429).json({ 
          error: `Too many slow connections from this IP (${clientIp})`,
          retryAfter: Math.ceil((this.getBlockTime(clientIp) - Date.now()) / 1000)
        });
      }

      this.addConnection(clientIp);
      this.setupConnectionTimeouts(req, res, clientIp);

      res.on('finish', () => this.removeConnection(clientIp));
      res.on('close', () => this.removeConnection(clientIp));
      next();
    };
  }

  getRequestValidationMiddleware() {
    return (req, res, next) => {
      const userAgent = req.get('User-Agent');
      const accept = req.get('Accept');
      
      if (userAgent && userAgent.length > 500) {
        console.warn(`[SECURITY] Invalid User-Agent from ${req.ip}: ${req.method} ${req.path}`);
        return res.status(400).json({ error: 'Invalid request' });
      }
      
      if (accept && accept.length > 1000) {
        console.warn(`[SECURITY] Invalid Accept header from ${req.ip}: ${req.method} ${req.path}`);
        return res.status(400).json({ error: 'Invalid request' });
      }
      
      if (req.url && req.url.length > 2048) {
        console.warn(`[SECURITY] Invalid URL length from ${req.ip}: ${req.method} ${req.path}`);
        return res.status(400).json({ error: 'Invalid request' });
      }
      
      next();
    };
  }

  validateFilename(filename) {
    if (!filename || filename.length > this.config.MAX_FILENAME_LENGTH) return false;
    if (!this.config.FILENAME_REGEX.test(filename)) return false;
    const dangerousChars = ['..', '\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    return !dangerousChars.some(char => filename.includes(char));
  }

  validateFileExtension(filename) {
    return this.config.ALLOWED_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));
  }

  validatePath(filePath, baseDir) {
    try {
      const resolvedPath = path.resolve(filePath);
      const resolvedBase = path.resolve(baseDir);
      if (!resolvedPath.startsWith(resolvedBase)) return false;
      return fs.realpathSync(resolvedPath).startsWith(fs.realpathSync(resolvedBase));
    } catch {
      return false;
    }
  }

  validateFile(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return stats.size > 0;
    } catch {
      return false;
    }
  }

  getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = { '.gz': 'application/gzip', '.tar.gz': 'application/gzip', '.json': 'application/json' };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  validateMimeType(filename) {
    return this.config.ALLOWED_MIME_TYPES.includes(this.getMimeType(filename));
  }

  sanitizeFilename(filename) {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '');
  }

  getSecurityHeaders() {
    return {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'
    };
  }

  isIpBlocked(ip) {
    const tracker = this.connectionMap.get(ip);
    if (!tracker) return false;
    if (tracker.isBlocked && Date.now() < tracker.blockUntil) return true;
    if (tracker.isBlocked && Date.now() >= tracker.blockUntil) {
      tracker.isBlocked = false;
      tracker.blockUntil = 0;
    }
    return false;
  }

  getBlockTime(ip) {
    return this.connectionMap.get(ip)?.blockUntil || 0;
  }

  addConnection(ip) {
    let tracker = this.connectionMap.get(ip);
    if (!tracker) {
      tracker = { ip, connections: 0, slowConnections: 0, lastActivity: Date.now(), 
                 isBlocked: false, blockUntil: 0, firstConnection: Date.now(), 
                 requestCount: 0, timeoutCount: 0 };
      this.connectionMap.set(ip, tracker);
    }

    tracker.connections++;
    tracker.lastActivity = Date.now();
    tracker.requestCount++;

    const timeSinceFirst = Date.now() - tracker.firstConnection;
    const adaptiveThreshold = Math.min(this.config.MAX_CONCURRENT_CONNECTIONS, 
                                      Math.max(20, Math.floor(timeSinceFirst / 5000)));
    const timeoutRatio = tracker.timeoutCount / Math.max(tracker.requestCount, 1);
    
    if (tracker.connections > adaptiveThreshold && 
        timeSinceFirst > this.config.SLOW_LORIS_GRACE_PERIOD &&
        (timeoutRatio > 0.5 || tracker.connections > this.config.MAX_SLOW_CONNECTIONS)) {
      tracker.isBlocked = true;
      tracker.blockUntil = Date.now() + this.config.SLOW_LORIS_BLOCK_DURATION;
    }
  }

  removeConnection(ip) {
    const tracker = this.connectionMap.get(ip);
    if (tracker && tracker.connections > 0) {
      tracker.connections--;
      tracker.lastActivity = Date.now();
    }
  }

  setupConnectionTimeouts(req, res, clientIp) {
    req.setTimeout(this.config.REQUEST_TIMEOUT, () => {
      this.recordTimeout(clientIp);
      if (!res.headersSent) res.status(408).json({ error: 'Request timeout' });
    });

    res.setTimeout(this.config.RESPONSE_TIMEOUT, () => {
      this.recordTimeout(clientIp);
      if (!res.headersSent) res.status(408).json({ error: 'Response timeout' });
    });

    const connectionTimeout = setTimeout(() => {
      this.recordTimeout(clientIp);
      if (!res.headersSent) res.status(408).json({ error: 'Connection timeout' });
      res.end();
    }, this.config.CONNECTION_TIMEOUT);

    res.on('finish', () => clearTimeout(connectionTimeout));
    res.on('close', () => clearTimeout(connectionTimeout));
  }

  recordTimeout(ip) {
    const tracker = this.connectionMap.get(ip);
    if (tracker) {
      tracker.timeoutCount++;
      tracker.slowConnections++;
      const timeoutRatio = tracker.timeoutCount / Math.max(tracker.requestCount, 1);
      if (timeoutRatio > 0.7 && tracker.timeoutCount > 10) {
        tracker.isBlocked = true;
        tracker.blockUntil = Date.now() + this.config.SLOW_LORIS_BLOCK_DURATION;
        console.warn(`[SECURITY] Blocking IP ${ip} - High timeout ratio: ${timeoutRatio.toFixed(2)}`);
      }
    }
  }

  handleDownloadProtection(req, res, next, clientIp) {
    if (this.isDownloadBlocked(clientIp)) {
      console.warn(`[SECURITY] Blocked download from ${clientIp}`);
      return res.status(429).json({ 
        error: `Too many slow downloads from this IP (${clientIp})`,
        retryAfter: Math.ceil((this.getDownloadBlockTime(clientIp) - Date.now()) / 1000)
      });
    }

    this.addDownload(clientIp);
    this.setupDownloadMonitoring(req, res, clientIp);
    res.on('finish', () => this.removeDownload(clientIp));
    res.on('close', () => this.removeDownload(clientIp));
    next();
  }

  isDownloadBlocked(ip) {
    const tracker = this.downloadMap.get(ip);
    if (!tracker) return false;
    if (tracker.isBlocked && Date.now() < tracker.blockUntil) return true;
    if (tracker.isBlocked && Date.now() >= tracker.blockUntil) {
      tracker.isBlocked = false;
      tracker.blockUntil = 0;
    }
    return false;
  }

  getDownloadBlockTime(ip) {
    return this.downloadMap.get(ip)?.blockUntil || 0;
  }

  addDownload(ip) {
    let tracker = this.downloadMap.get(ip);
    if (!tracker) {
      tracker = { ip, activeDownloads: 0, slowDownloads: 0, totalBytesTransferred: 0,
                 lastActivity: Date.now(), isBlocked: false, blockUntil: 0,
                 downloadStartTime: Date.now(), lastTransferTime: Date.now(), transferRate: 0 };
      this.downloadMap.set(ip, tracker);
    }

    tracker.activeDownloads++;
    tracker.lastActivity = Date.now();
    tracker.downloadStartTime = Date.now();
    tracker.lastTransferTime = Date.now();

    if (tracker.activeDownloads > this.config.DOWNLOAD_SLOW_LORIS.MAX_SLOW_DOWNLOADS) {
      tracker.isBlocked = true;
      tracker.blockUntil = Date.now() + this.config.DOWNLOAD_SLOW_LORIS.BLOCK_DURATION;
      console.warn(`[SECURITY] Blocking IP ${ip} - Too many concurrent downloads: ${tracker.activeDownloads}`);
    }
  }

  removeDownload(ip) {
    const tracker = this.downloadMap.get(ip);
    if (tracker && tracker.activeDownloads > 0) {
      tracker.activeDownloads--;
      tracker.lastActivity = Date.now();
    }
  }

  setupDownloadMonitoring(req, res, clientIp) {
    const tracker = this.downloadMap.get(clientIp);
    if (!tracker) return;

    let bytesTransferred = 0;
    const startTime = Date.now();
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    res.write = function(chunk, encoding, callback) {
      if (chunk && Buffer.isBuffer(chunk)) {
        bytesTransferred += chunk.length;
        tracker.totalBytesTransferred += chunk.length;
        const now = Date.now();
        if (now - tracker.lastTransferTime > 1000) {
          tracker.transferRate = bytesTransferred / ((now - startTime) / 1000);
          tracker.lastTransferTime = now;
          if (tracker.transferRate < this.config.DOWNLOAD_SLOW_LORIS.SLOW_DOWNLOAD_THRESHOLD) {
            tracker.slowDownloads++;
            console.warn(`[SECURITY] Slow download from ${clientIp}: ${tracker.transferRate.toFixed(2)} bytes/s`);
          }
        }
      }
      return originalWrite(chunk, encoding, callback);
    }.bind(this);

    res.end = function(chunk, encoding, callback) {
      if (chunk && Buffer.isBuffer(chunk)) {
        bytesTransferred += chunk.length;
        tracker.totalBytesTransferred += chunk.length;
      }
      return originalEnd(chunk, encoding, callback);
    };

    const downloadTimeout = setTimeout(() => {
      if (tracker.transferRate < this.config.DOWNLOAD_SLOW_LORIS.MIN_TRANSFER_RATE) {
        tracker.isBlocked = true;
        tracker.blockUntil = Date.now() + this.config.DOWNLOAD_SLOW_LORIS.BLOCK_DURATION;
        console.warn(`[SECURITY] Blocking IP ${clientIp} - Download too slow: ${tracker.transferRate.toFixed(2)} bytes/s`);
        if (!res.headersSent) res.status(408).json({ error: 'Download too slow, connection terminated' });
        res.end();
      }
    }, this.config.DOWNLOAD_SLOW_LORIS.MAX_DOWNLOAD_DURATION);

    res.on('finish', () => clearTimeout(downloadTimeout));
    res.on('close', () => clearTimeout(downloadTimeout));
  }

  cleanupExpiredConnections() {
    const now = Date.now();
    for (const [ip, tracker] of this.connectionMap.entries()) {
      if ((now - tracker.lastActivity > 600000 && tracker.connections === 0) ||
          (tracker.isBlocked && now >= tracker.blockUntil)) {
        this.connectionMap.delete(ip);
      }
    }
    for (const [ip, tracker] of this.downloadMap.entries()) {
      if ((now - tracker.lastActivity > 1800000 && tracker.activeDownloads === 0) ||
          (tracker.isBlocked && now >= tracker.blockUntil)) {
        this.downloadMap.delete(ip);
      }
    }
  }

  destroy() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.connectionMap.clear();
    this.downloadMap.clear();
  }
}

const snapshotSecurity = new SnapshotSecurity();

module.exports = { SnapshotSecurity, snapshotSecurity };

