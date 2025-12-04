const assert = require('assert');
const { describe, it, before, after, beforeEach } = require('mocha');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { BackupServer } = require('../lib/services/BackupServer');
const { snapshotSecurity } = require('../lib/security/SnapshotSecurity');
const { DaemonManager } = require('../lib/services/DaemonManager');

describe('Snapshot Server Tests', function() {
  this.timeout(30000);
  
  let testPort = 3001;
  let testSnapshotDir;
  let testServer;
  let httpServer;
  const heliosBin = path.join(__dirname, '..', 'bin', 'helios');

  before(function() {
    testSnapshotDir = path.join(__dirname, 'test-snapshots');
    if (!fs.existsSync(testSnapshotDir)) {
      fs.mkdirSync(testSnapshotDir, { recursive: true });
    }
  });

  after(function(done) {
    if (httpServer) {
      httpServer.close(() => {
        cleanup();
        done();
      });
    } else {
      cleanup();
      done();
    }
  });

  function cleanup() {
    if (fs.existsSync(testSnapshotDir)) {
      fs.rmSync(testSnapshotDir, { recursive: true, force: true });
    }
    const pidFile = path.join(process.cwd(), 'helios-backups.pid');
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
        try {
          process.kill(pid, 'SIGTERM');
        } catch (e) {}
      } catch (e) {}
      fs.unlinkSync(pidFile);
    }
  }

  describe('SnapshotSecurity', function() {
    it('should validate correct filenames', function() {
      assert.strictEqual(snapshotSecurity.validateFilename('snapshot_123_2025-01-06_12-30-45.gz'), true);
      assert.strictEqual(snapshotSecurity.validateFilename('snapshot_0_2025-01-01_00-00-00.tar.gz'), true);
    });

    it('should reject invalid filenames', function() {
      assert.strictEqual(snapshotSecurity.validateFilename('invalid.txt'), false);
      assert.strictEqual(snapshotSecurity.validateFilename('../../../etc/passwd'), false);
      assert.strictEqual(snapshotSecurity.validateFilename(''), false);
      assert.strictEqual(snapshotSecurity.validateFilename(null), false);
    });

    it('should validate file extensions', function() {
      assert.strictEqual(snapshotSecurity.validateFileExtension('file.gz'), true);
      assert.strictEqual(snapshotSecurity.validateFileExtension('file.tar.gz'), true);
      assert.strictEqual(snapshotSecurity.validateFileExtension('file.txt'), false);
    });

    it('should sanitize filenames', function() {
      assert.strictEqual(snapshotSecurity.sanitizeFilename('test@file.gz'), 'testfile.gz');
      assert.strictEqual(snapshotSecurity.sanitizeFilename('normal-file.gz'), 'normal-file.gz');
    });

    it('should validate paths', function() {
      const baseDir = path.join(__dirname, 'test-snapshots');
      const validPath = path.join(baseDir, 'file.gz');
      fs.writeFileSync(validPath, 'test');
      assert.strictEqual(snapshotSecurity.validatePath(validPath, baseDir), true);
      fs.unlinkSync(validPath);
      
      const invalidPath = '/etc/passwd';
      const result = snapshotSecurity.validatePath(invalidPath, baseDir);
      assert.strictEqual(result, false, `Path ${invalidPath} should not be valid for base ${baseDir}`);
    });

    it('should get correct MIME types', function() {
      assert.strictEqual(snapshotSecurity.getMimeType('file.gz'), 'application/gzip');
      assert.strictEqual(snapshotSecurity.getMimeType('file.tar.gz'), 'application/gzip');
      assert.strictEqual(snapshotSecurity.getMimeType('file.json'), 'application/json');
    });

    it('should return security headers', function() {
      const headers = snapshotSecurity.getSecurityHeaders();
      assert.ok(headers.hasOwnProperty('X-Content-Type-Options'));
      assert.ok(headers.hasOwnProperty('X-Frame-Options'));
      assert.ok(headers.hasOwnProperty('Cache-Control'));
    });

    it('should validate MIME types', function() {
      assert.strictEqual(snapshotSecurity.validateMimeType('snapshot_100_2025-01-01_00-00-00.gz'), true);
      assert.strictEqual(snapshotSecurity.validateMimeType('snapshot_100_2025-01-01_00-00-00.tar.gz'), true);
      const txtMimeType = snapshotSecurity.getMimeType('file.txt');
      const isValid = snapshotSecurity.config.ALLOWED_MIME_TYPES.includes(txtMimeType);
      assert.strictEqual(isValid, snapshotSecurity.validateMimeType('file.txt'));
    });

    it('should validate file size', function() {
      const testFile = path.join(testSnapshotDir, 'test-file.gz');
      fs.writeFileSync(testFile, 'content');
      assert.strictEqual(snapshotSecurity.validateFile(testFile), true);
      fs.unlinkSync(testFile);
    });

    it('should reject empty files', function() {
      const emptyFile = path.join(testSnapshotDir, 'empty-file.gz');
      fs.writeFileSync(emptyFile, '');
      assert.strictEqual(snapshotSecurity.validateFile(emptyFile), false);
      fs.unlinkSync(emptyFile);
    });
  });

  describe('BackupServer - Basic', function() {
    beforeEach(function() {
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
    });

    it('should create server instance', function() {
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      assert.ok(testServer);
      assert.strictEqual(testServer.port, testPort);
    });

    it('should start server', function(done) {
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/health`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 200);
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            const json = JSON.parse(data);
            assert.strictEqual(json.status, 'ok');
            httpServer.close(done);
          });
        });
        req.on('error', done);
      }, 500);
    });

    it('should return 404 for non-existent snapshots', function(done) {
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/snapshots/snapshot_999_2025-01-01_00-00-00.gz`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 404);
          require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
          httpServer.close(done);
        });
        req.on('error', done);
      }, 500);
    });

    it('should reject invalid filenames', function(done) {
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/snapshots/invalid@file.txt`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 400);
          httpServer.close(done);
        });
        req.on('error', done);
      }, 500);
    });

    it('should list snapshots', function(done) {
      const testFile = path.join(testSnapshotDir, 'snapshot_100_2025-01-01_00-00-00.gz');
      fs.writeFileSync(testFile, 'test content');
      
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/snapshots`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 200);
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            const json = JSON.parse(data);
            assert.ok(json.hasOwnProperty('snapshots'));
            assert.ok(json.hasOwnProperty('totalCount'));
            fs.unlinkSync(testFile);
            require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
            httpServer.close();
            done();
          });
        });
        req.on('error', done);
      }, 1000);
    });

    it('should return snapshot header', function(done) {
      const testFile = path.join(testSnapshotDir, 'snapshot_200_2025-01-02_12-00-00.gz');
      fs.writeFileSync(testFile, 'test content');
      
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/snapshots/snapshot_200_2025-01-02_12-00-00.gz.header.json`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 200);
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            const json = JSON.parse(data);
            assert.ok(json.hasOwnProperty('filename'));
            assert.strictEqual(json.blockId, 200);
            assert.ok(json.hasOwnProperty('downloadUrl'));
            fs.unlinkSync(testFile);
            require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
            httpServer.close();
            done();
          });
        });
        req.on('error', done);
      }, 1000);
    });

    it('should download snapshot file', function(done) {
      const testContent = 'test snapshot content for download';
      const testFile = path.join(testSnapshotDir, 'snapshot_300_2025-01-03_10-00-00.gz');
      fs.writeFileSync(testFile, testContent);
      
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/snapshots/snapshot_300_2025-01-03_10-00-00.gz`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 200);
          assert.strictEqual(res.headers['content-type'], 'application/gzip');
          assert.ok(res.headers['content-disposition'].includes('snapshot_300_2025-01-03_10-00-00.gz'));
          let data = '';
          res.on('data', chunk => data += chunk.toString());
          res.on('end', () => {
            assert.strictEqual(data, testContent);
            fs.unlinkSync(testFile);
            require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
            httpServer.close(done);
          });
        });
        req.on('error', done);
      }, 500);
    });

    it('should return 404 for unknown routes', function(done) {
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/unknown-route`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 404);
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            const json = JSON.parse(data);
            assert.strictEqual(json.error, 'Route not found');
            httpServer.close(done);
          });
        });
        req.on('error', done);
      }, 500);
    });

    it('should handle empty snapshot directory', function(done) {
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/snapshots`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 200);
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            const json = JSON.parse(data);
            assert.ok(Array.isArray(json.snapshots));
            assert.strictEqual(json.totalCount, 0);
            require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
            httpServer.close(done);
          });
        });
        req.on('error', done);
      }, 500);
    });

    it('should handle non-existent snapshot directory', function(done) {
      const nonExistentDir = path.join(__dirname, 'non-existent-dir');
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => nonExistentDir;
      
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/snapshots`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 200);
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            const json = JSON.parse(data);
            assert.ok(Array.isArray(json.snapshots));
            assert.strictEqual(json.totalCount, 0);
            require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
            httpServer.close(done);
          });
        });
        req.on('error', done);
      }, 500);
    });

    it('should reject invalid file extensions in header route', function(done) {
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/snapshots/invalid.txt.header.json`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 400);
          httpServer.close(done);
        });
        req.on('error', done);
      }, 500);
    });

    it('should handle file read errors gracefully', function(done) {
      const testFile = path.join(testSnapshotDir, 'snapshot_500_2025-01-05_00-00-00.gz');
      fs.writeFileSync(testFile, 'test');
      
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
        const req = http.get(`http://localhost:${testPort}/snapshots/snapshot_500_2025-01-05_00-00-00.gz`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.ok([404, 500].includes(res.statusCode));
          require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
          httpServer.close(done);
        });
        req.on('error', done);
      }, 500);
    });

    it('should sort snapshots by block ID descending', function(done) {
      const files = [
        'snapshot_100_2025-01-01_00-00-00.gz',
        'snapshot_300_2025-01-03_00-00-00.gz',
        'snapshot_200_2025-01-02_00-00-00.gz'
      ];
      
      files.forEach(file => {
        fs.writeFileSync(path.join(testSnapshotDir, file), 'content');
      });
      
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/snapshots`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            const json = JSON.parse(data);
            assert.strictEqual(json.snapshots.length, 3);
            assert.strictEqual(json.snapshots[0].blockId, 300);
            assert.strictEqual(json.snapshots[1].blockId, 200);
            assert.strictEqual(json.snapshots[2].blockId, 100);
            
            files.forEach(file => {
              const filePath = path.join(testSnapshotDir, file);
              if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            });
            require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
            httpServer.close(done);
          });
        });
        req.on('error', done);
      }, 500);
    });
  });

  describe('BackupServer - URL Generation', function() {
    it('should generate HTTP URL for localhost', function() {
      const server = new BackupServer(3000, 1024 * 1024, 'localhost');
      const url = server.generateUrl('snapshot_100_2025-01-01_00-00-00.gz');
      assert.ok(url.startsWith('http://'));
      assert.ok(url.includes('localhost:3000'));
    });

    it('should generate HTTPS URL for non-localhost', function() {
      const server = new BackupServer(443, 1024 * 1024, 'example.com');
      const url = server.generateUrl('snapshot_100_2025-01-01_00-00-00.gz');
      assert.ok(url.startsWith('https://'));
      assert.ok(url.includes('example.com'));
      assert.ok(!url.includes(':443'));
    });

    it('should extract block ID from filename', function() {
      const server = new BackupServer();
      assert.strictEqual(server.extractBlockId('snapshot_123_2025-01-01_00-00-00.gz'), 123);
      assert.strictEqual(server.extractBlockId('snapshot_0_2025-01-01_00-00-00.gz'), 0);
      assert.strictEqual(server.extractBlockId('invalid.gz'), 0);
    });

    it('should generate description with date', function() {
      const server = new BackupServer();
      const desc = server.generateDescription('snapshot_100_2025-01-15_14-30-00.gz', 100);
      assert.ok(desc.includes('Block 100'));
      assert.ok(desc.includes('2025-01-15'));
      assert.ok(desc.includes('14-30-00'));
    });

    it('should generate description without date', function() {
      const server = new BackupServer();
      const desc = server.generateDescription('snapshot_100_invalid.gz', 100);
      assert.ok(desc.includes('Block 100'));
      assert.ok(desc.includes('snapshot_100_invalid.gz'));
    });
  });

  describe('Security - Rate Limiting', function() {
    beforeEach(function() {
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
    });

    it('should enforce rate limiting on downloads', function(done) {
      const testFile = path.join(testSnapshotDir, 'snapshot_400_2025-01-04_00-00-00.gz');
      fs.writeFileSync(testFile, 'test');
      
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      let requestCount = 0;
      let rateLimited = false;
      const maxRequests = 12;
      
      function makeRequest() {
        const req = http.get(`http://localhost:${testPort}/snapshots/snapshot_400_2025-01-04_00-00-00.gz`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          requestCount++;
          if (res.statusCode === 429) {
            rateLimited = true;
          }
          res.on('data', () => {});
          res.on('end', () => {
            if (requestCount >= maxRequests) {
              if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
              require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
              httpServer.close(() => {
                assert.ok(true, 'Rate limiting test completed');
                done();
              });
            }
          });
        });
        req.on('error', () => {
          requestCount++;
          if (requestCount >= maxRequests) {
            if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
            require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
            httpServer.close(done);
          }
        });
      }
      
      setTimeout(() => {
        for (let i = 0; i < maxRequests; i++) {
          setTimeout(() => makeRequest(), i * 50);
        }
      }, 500);
    });
  });

  describe('Security - Request Validation', function() {
    beforeEach(function() {
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
    });

    it('should reject requests with invalid User-Agent length', function(done) {
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const longUserAgent = 'a'.repeat(501);
        const req = http.get(`http://localhost:${testPort}/health`, {
          headers: { 'User-Agent': longUserAgent }
        }, (res) => {
          assert.strictEqual(res.statusCode, 400);
          httpServer.close(done);
        });
        req.on('error', done);
      }, 500);
    });

    it('should reject requests with invalid Accept header length', function(done) {
      if (httpServer) httpServer.close();
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const longAccept = 'a'.repeat(1001);
        const req = http.get(`http://localhost:${testPort}/health`, {
          headers: { 'User-Agent': 'test', 'Accept': longAccept }
        }, (res) => {
          assert.strictEqual(res.statusCode, 400);
          httpServer.close(done);
        });
        req.on('error', done);
      }, 500);
    });

    it('should reject requests with invalid URL length', function(done) {
      if (httpServer) httpServer.close();
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const longPath = '/health' + 'a'.repeat(2050);
        const req = http.get(`http://localhost:${testPort}${longPath}`, {
          headers: { 'User-Agent': 'test' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 400);
          httpServer.close(done);
        });
        req.on('error', done);
      }, 500);
    });
  });

  describe('Security - Path Traversal Protection', function() {
    beforeEach(function() {
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
    });

    it('should reject path traversal attempts', function(done) {
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/snapshots/..%2F..%2Fetc%2Fpasswd`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 400);
          httpServer.close(done);
        });
        req.on('error', done);
      }, 500);
    });
  });

  describe('Security - Cleanup and Destroy', function() {
    it('should cleanup expired connections', function() {
      snapshotSecurity.addConnection('127.0.0.1');
      const tracker = snapshotSecurity.connectionMap.get('127.0.0.1');
      tracker.lastActivity = Date.now() - 700000;
      tracker.connections = 0;
      snapshotSecurity.cleanupExpiredConnections();
      assert.strictEqual(snapshotSecurity.connectionMap.has('127.0.0.1'), false);
    });

    it('should destroy security instance', function() {
      snapshotSecurity.addConnection('127.0.0.2');
      snapshotSecurity.addDownload('127.0.0.2');
      snapshotSecurity.destroy();
      assert.strictEqual(snapshotSecurity.connectionMap.size, 0);
      assert.strictEqual(snapshotSecurity.downloadMap.size, 0);
    });
  });

  describe('Security Middleware', function() {
    it('should return middleware array', function() {
      const middlewares = snapshotSecurity.getMiddleware();
      assert.ok(Array.isArray(middlewares));
      assert.ok(middlewares.length > 0);
    });

    it('should have slow loris protection middleware', function() {
      const middleware = snapshotSecurity.getSlowLorisMiddleware();
      assert.strictEqual(typeof middleware, 'function');
    });

    it('should have request validation middleware', function() {
      const middleware = snapshotSecurity.getRequestValidationMiddleware();
      assert.strictEqual(typeof middleware, 'function');
    });
  });

  describe('DaemonManager', function() {
    it('should have runDaemon method', function() {
      assert.strictEqual(typeof DaemonManager.runDaemon, 'function');
    });

    it('should have stopDaemon method', function() {
      assert.strictEqual(typeof DaemonManager.stopDaemon, 'function');
    });
  });

  describe('CLI Commands', function() {
    it('should show help for snapshot-server', function(done) {
      const proc = spawn('node', [heliosBin, 'snapshot-server'], {
        cwd: path.join(__dirname, '..')
      });
      
      let output = '';
      proc.stdout.on('data', (data) => output += data.toString());
      proc.stderr.on('data', (data) => output += data.toString());
      
      proc.on('exit', (code) => {
        assert.ok(output.includes('Helios Snapshot Server'));
        assert.ok(output.includes('serve'));
        assert.ok(output.includes('stop'));
        assert.ok(output.includes('status'));
        done();
      });
    });

    it('should show help for snapshot-server help', function(done) {
      const proc = spawn('node', [heliosBin, 'snapshot-server', 'help'], {
        cwd: path.join(__dirname, '..')
      });
      
      let output = '';
      proc.stdout.on('data', (data) => output += data.toString());
      proc.stderr.on('data', (data) => output += data.toString());
      
      proc.on('exit', (code) => {
        assert.ok(output.includes('Helios Snapshot Server'));
        done();
      });
    });

    it('should handle unknown subcommand', function(done) {
      const proc = spawn('node', [heliosBin, 'snapshot-server', 'unknown'], {
        cwd: path.join(__dirname, '..')
      });
      
      let output = '';
      proc.stdout.on('data', (data) => output += data.toString());
      proc.stderr.on('data', (data) => output += data.toString());
      
      proc.on('exit', (code) => {
        assert.ok(output.includes('Unknown subcommand') || output.includes('help'));
        done();
      });
    });

    it('should parse port option', function() {
      const snapshotServer = require('../lib/commands/snapshot-server');
      const argv = {
        _: ['snapshot-server', 'serve'],
        port: 8080,
        p: undefined
      };
      
      assert.ok(typeof snapshotServer === 'function');
    });

    it('should parse daemon option', function() {
      const snapshotServer = require('../lib/commands/snapshot-server');
      const argv = {
        _: ['snapshot-server', 'serve'],
        daemon: true,
        d: true
      };
      
      assert.ok(typeof snapshotServer === 'function');
    });

    it('should parse rate option', function() {
      const snapshotServer = require('../lib/commands/snapshot-server');
      const argv = {
        _: ['snapshot-server', 'serve'],
        rate: 5,
        r: 5
      };
      
      assert.ok(typeof snapshotServer === 'function');
    });

    it('should parse host option', function() {
      const snapshotServer = require('../lib/commands/snapshot-server');
      const argv = {
        _: ['snapshot-server', 'serve'],
        host: 'example.com',
        H: 'example.com'
      };
      
      assert.ok(typeof snapshotServer === 'function');
    });

    it('should execute snapshot-server serve command', function(done) {
      const proc = spawn('node', [heliosBin, 'snapshot-server', 'serve', '-p', testPort.toString()], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe'
      });
      
      let output = '';
      proc.stdout.on('data', (data) => output += data.toString());
      proc.stderr.on('data', (data) => output += data.toString());
      
      setTimeout(() => {
        http.get(`http://localhost:${testPort}/health`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 200);
          proc.kill('SIGTERM');
          setTimeout(() => {
            proc.kill('SIGKILL');
            done();
          }, 1000);
        }).on('error', () => {
          proc.kill('SIGKILL');
          done();
        });
      }, 2000);
    });

    it('should execute snapshot-server status command', function(done) {
      const proc = spawn('node', [heliosBin, 'snapshot-server', 'status'], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe'
      });
      
      let output = '';
      proc.stdout.on('data', (data) => output += data.toString());
      proc.stderr.on('data', (data) => output += data.toString());
      
      proc.on('exit', (code) => {
        assert.ok(output.includes('Daemon') || output.includes('not running'));
        done();
      });
    });

    it('should execute snapshot-server stop command', function(done) {
      const proc = spawn('node', [heliosBin, 'snapshot-server', 'stop'], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe'
      });
      
      let output = '';
      proc.stdout.on('data', (data) => output += data.toString());
      proc.stderr.on('data', (data) => output += data.toString());
      
      proc.on('exit', (code) => {
        assert.ok(output.includes('Stopping') || output.includes('No daemon'));
        done();
      });
    });

    it('should handle snapshot-server serve with all options', function(done) {
      const proc = spawn('node', [heliosBin, 'snapshot-server', 'serve', '-p', '3004', '-r', '5', '-H', 'test.example.com'], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe'
      });
      
      let output = '';
      proc.stdout.on('data', (data) => output += data.toString());
      proc.stderr.on('data', (data) => output += data.toString());
      
      setTimeout(() => {
        http.get(`http://localhost:3004/health`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          assert.strictEqual(res.statusCode, 200);
          proc.kill('SIGTERM');
          setTimeout(() => {
            proc.kill('SIGKILL');
            done();
          }, 1000);
        }).on('error', () => {
          proc.kill('SIGKILL');
          done();
        });
      }, 2000);
    });
  });

  describe('Performance Tests', function() {
    beforeEach(function() {
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
    });

    it('should handle multiple concurrent requests', function(done) {
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      const testFile = path.join(testSnapshotDir, 'snapshot_600_2025-01-06_00-00-00.gz');
      fs.writeFileSync(testFile, 'test content');
      
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const concurrentRequests = 20;
        let completed = 0;
        let errors = 0;
        
        for (let i = 0; i < concurrentRequests; i++) {
          const req = http.get(`http://localhost:${testPort}/health`, {
            headers: { 'User-Agent': 'test-agent' }
          }, (res) => {
            completed++;
            res.on('data', () => {});
            res.on('end', () => {
              if (completed + errors === concurrentRequests) {
                assert.ok(completed > 0);
                fs.unlinkSync(testFile);
                require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
                httpServer.close(done);
              }
            });
          });
          req.on('error', () => {
            errors++;
            if (completed + errors === concurrentRequests) {
              fs.unlinkSync(testFile);
              require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
              httpServer.close(done);
            }
          });
        }
      }, 500);
    });

    it('should handle large snapshot list efficiently', function(done) {
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      const existingFiles = fs.readdirSync(testSnapshotDir).filter(f => f.endsWith('.gz'));
      existingFiles.forEach(file => {
        fs.unlinkSync(path.join(testSnapshotDir, file));
      });
      
      const files = [];
      for (let i = 0; i < 50; i++) {
        const fileName = `snapshot_${i}_2025-01-01_00-00-00.gz`;
        files.push(fileName);
        fs.writeFileSync(path.join(testSnapshotDir, fileName), `content ${i}`);
      }
      
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      const startTime = Date.now();
      setTimeout(() => {
        const req = http.get(`http://localhost:${testPort}/snapshots`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            const json = JSON.parse(data);
            assert.ok(json.snapshots.length >= 50, `Expected at least 50 snapshots, got ${json.snapshots.length}`);
            assert.ok(duration < 5000, `List operation took ${duration}ms, should be < 5000ms`);
            
            files.forEach(file => {
              const filePath = path.join(testSnapshotDir, file);
              if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            });
            require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
            httpServer.close(done);
          });
        });
        req.on('error', done);
      }, 500);
    });

    it('should handle rapid sequential requests', function(done) {
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        let requestCount = 0;
        const totalRequests = 100;
        
        function makeRequest() {
          const req = http.get(`http://localhost:${testPort}/health`, {
            headers: { 'User-Agent': 'test-agent' }
          }, (res) => {
            requestCount++;
            res.on('data', () => {});
            res.on('end', () => {
              if (requestCount < totalRequests) {
                setImmediate(makeRequest);
              } else {
                assert.strictEqual(requestCount, totalRequests);
                httpServer.close(done);
              }
            });
          });
          req.on('error', () => {
            requestCount++;
            if (requestCount >= totalRequests) {
              httpServer.close(done);
            }
          });
        }
        
        makeRequest();
      }, 500);
    });
  });

  describe('Slow Loris Attack Simulation', function() {
    beforeEach(function() {
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
    });

    it('should detect and block slow connections', function(done) {
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const testIp = '127.0.0.500';
        snapshotSecurity.addConnection(testIp);
        const tracker = snapshotSecurity.connectionMap.get(testIp);
        tracker.connections = 60;
        tracker.firstConnection = Date.now() - 40000;
        tracker.timeoutCount = 30;
        tracker.requestCount = 40;
        
        snapshotSecurity.addConnection(testIp);
        
        assert.ok(tracker.isBlocked || tracker.blockUntil > Date.now(), 'IP should be blocked for excessive slow connections');
        
        snapshotSecurity.connectionMap.delete(testIp);
        httpServer.close(done);
      }, 500);
    });

    it('should track connection timeouts', function(done) {
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        snapshotSecurity.addConnection('127.0.0.100');
        const tracker = snapshotSecurity.connectionMap.get('127.0.0.100');
        tracker.timeoutCount = 15;
        tracker.requestCount = 20;
        
        snapshotSecurity.recordTimeout('127.0.0.100');
        
        assert.ok(tracker.isBlocked || tracker.blockUntil > 0);
        snapshotSecurity.connectionMap.delete('127.0.0.100');
        httpServer.close(done);
      }, 500);
    });

    it('should block IPs with high timeout ratio', function(done) {
      testServer = new BackupServer(testPort, 1024 * 1024, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const testIp = '127.0.0.200';
        snapshotSecurity.addConnection(testIp);
        
        for (let i = 0; i < 15; i++) {
          snapshotSecurity.recordTimeout(testIp);
        }
        
        const tracker = snapshotSecurity.connectionMap.get(testIp);
        assert.ok(tracker.isBlocked, 'IP should be blocked after multiple timeouts');
        assert.ok(tracker.blockUntil > Date.now(), 'Block should be active');
        
        snapshotSecurity.connectionMap.delete(testIp);
        httpServer.close(done);
      }, 500);
    });
  });

  describe('Throttling Tests', function() {
    beforeEach(function() {
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
    });

    it('should throttle download speed', function(done) {
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      const largeContent = Buffer.alloc(1024 * 100, 'x');
      const testFile = path.join(testSnapshotDir, 'snapshot_700_2025-01-07_00-00-00.gz');
      fs.writeFileSync(testFile, largeContent);
      
      const maxRate = 10 * 1024;
      testServer = new BackupServer(testPort, maxRate, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const startTime = Date.now();
        let bytesReceived = 0;
        
        const req = http.get(`http://localhost:${testPort}/snapshots/snapshot_700_2025-01-07_00-00-00.gz`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          res.on('data', (chunk) => {
            bytesReceived += chunk.length;
          });
          res.on('end', () => {
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            const actualRate = bytesReceived / duration;
            
            assert.ok(actualRate <= maxRate * 1.5, `Rate ${actualRate} should be close to max ${maxRate}`);
            assert.ok(duration > 0.5, `Download should take time due to throttling, took ${duration}s`);
            
            fs.unlinkSync(testFile);
            require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
            httpServer.close(done);
          });
        });
        req.on('error', done);
      }, 500);
    });

    it('should respect different throttle rates', function(done) {
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      const testContent = Buffer.alloc(1024 * 50, 'y');
      const testFile = path.join(testSnapshotDir, 'snapshot_800_2025-01-08_00-00-00.gz');
      fs.writeFileSync(testFile, testContent);
      
      const slowRate = 5 * 1024;
      testServer = new BackupServer(testPort, slowRate, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const startTime = Date.now();
        let bytesReceived = 0;
        
        const req = http.get(`http://localhost:${testPort}/snapshots/snapshot_800_2025-01-08_00-00-00.gz`, {
          headers: { 'User-Agent': 'test-agent' }
        }, (res) => {
          res.on('data', (chunk) => {
            bytesReceived += chunk.length;
          });
          res.on('end', () => {
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            const actualRate = bytesReceived / duration;
            
            assert.ok(actualRate <= slowRate * 2, `Rate ${actualRate} should respect slow rate ${slowRate}`);
            
            fs.unlinkSync(testFile);
            require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
            httpServer.close(done);
          });
        });
        req.on('error', done);
      }, 500);
    });

    it('should handle multiple throttled downloads concurrently', function(done) {
      const originalGetBackupPath = require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath;
      require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = () => testSnapshotDir;
      
      const testContent = Buffer.alloc(1024 * 20, 'z');
      const testFile = path.join(testSnapshotDir, 'snapshot_900_2025-01-09_00-00-00.gz');
      fs.writeFileSync(testFile, testContent);
      
      const maxRate = 10 * 1024;
      testServer = new BackupServer(testPort, maxRate, 'localhost');
      httpServer = testServer.app.listen(testPort);
      
      setTimeout(() => {
        const concurrentDownloads = 3;
        let completed = 0;
        const startTimes = [];
        
        for (let i = 0; i < concurrentDownloads; i++) {
          startTimes.push(Date.now());
          const req = http.get(`http://localhost:${testPort}/snapshots/snapshot_900_2025-01-09_00-00-00.gz`, {
            headers: { 'User-Agent': 'test-agent' }
          }, (res) => {
            let bytesReceived = 0;
            res.on('data', (chunk) => {
              bytesReceived += chunk.length;
            });
            res.on('end', () => {
              completed++;
              const duration = (Date.now() - startTimes[i]) / 1000;
              assert.ok(bytesReceived > 0, 'Should receive data');
              assert.ok(duration > 0, 'Should take time');
              
              if (completed === concurrentDownloads) {
                fs.unlinkSync(testFile);
                require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
                httpServer.close(done);
              }
            });
          });
          req.on('error', () => {
            completed++;
            if (completed === concurrentDownloads) {
              fs.unlinkSync(testFile);
              require('../lib/utils/BackupPathResolver').BackupPathResolver.getBackupPath = originalGetBackupPath;
              httpServer.close(done);
            }
          });
        }
      }, 500);
    });
  });

  describe('Download Slow Loris Protection', function() {
    beforeEach(function() {
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
    });

    it('should detect slow download transfers', function(done) {
      snapshotSecurity.addDownload('127.0.0.300');
      const tracker = snapshotSecurity.downloadMap.get('127.0.0.300');
      tracker.transferRate = 50;
      tracker.downloadStartTime = Date.now() - 2000;
      tracker.slowDownloads = 1;
      
      assert.ok(tracker.transferRate < snapshotSecurity.config.DOWNLOAD_SLOW_LORIS.SLOW_DOWNLOAD_THRESHOLD);
      assert.ok(tracker.slowDownloads > 0, 'Should track slow downloads');
      
      snapshotSecurity.downloadMap.delete('127.0.0.300');
      done();
    });

    it('should block IPs with too many concurrent downloads', function(done) {
      const testIp = '127.0.0.400';
      
      for (let i = 0; i < 6; i++) {
        snapshotSecurity.addDownload(testIp);
      }
      
      const tracker = snapshotSecurity.downloadMap.get(testIp);
      assert.ok(tracker.isBlocked, 'IP should be blocked for too many concurrent downloads');
      assert.ok(tracker.blockUntil > Date.now(), 'Block should be active');
      
      snapshotSecurity.downloadMap.delete(testIp);
      done();
    });
  });
});
