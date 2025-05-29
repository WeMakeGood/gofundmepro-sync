const sqlite3 = require('sqlite3').verbose();
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class Database {
  constructor() {
    this.type = process.env.DB_TYPE || 'sqlite';
    this.connection = null;
  }

  async connect() {
    try {
      if (this.type === 'sqlite') {
        await this.connectSQLite();
      } else if (this.type === 'mysql') {
        await this.connectMySQL();
      } else {
        throw new Error(`Unsupported database type: ${this.type}`);
      }
      
      logger.info(`Connected to ${this.type} database`);
      return this.connection;
    } catch (error) {
      logger.error('Database connection failed:', error);
      throw error;
    }
  }

  async connectSQLite() {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/classy.db');
    
    // Ensure data directory exists
    const dataDir = path.dirname(dbPath);
    try {
      await fs.access(dataDir);
    } catch {
      await fs.mkdir(dataDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      this.connection = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          // Enable foreign key constraints
          this.connection.run('PRAGMA foreign_keys = ON');
          resolve(this.connection);
        }
      });
    });
  }

  async connectMySQL() {
    const config = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'sync_user',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'classy_sync'
    };

    this.connection = await mysql.createConnection(config);
    
    // Test the connection
    await this.connection.ping();
  }

  async query(sql, params = []) {
    if (!this.connection) {
      throw new Error('Database not connected');
    }

    if (this.type === 'sqlite') {
      return this.querySQLite(sql, params);
    } else {
      return this.queryMySQL(sql, params);
    }
  }

  async querySQLite(sql, params) {
    return new Promise((resolve, reject) => {
      if (sql.trim().toLowerCase().startsWith('select')) {
        this.connection.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      } else {
        this.connection.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve({ 
            lastID: this.lastID,
            changes: this.changes
          });
        });
      }
    });
  }

  async queryMySQL(sql, params) {
    const [rows] = await this.connection.execute(sql, params);
    return rows;
  }

  async beginTransaction() {
    if (this.type === 'sqlite') {
      await this.query('BEGIN TRANSACTION');
    } else {
      await this.connection.beginTransaction();
    }
  }

  async commit() {
    if (this.type === 'sqlite') {
      await this.query('COMMIT');
    } else {
      await this.connection.commit();
    }
  }

  async rollback() {
    if (this.type === 'sqlite') {
      await this.query('ROLLBACK');
    } else {
      await this.connection.rollback();
    }
  }

  async close() {
    if (this.connection) {
      if (this.type === 'sqlite') {
        return new Promise((resolve) => {
          this.connection.close(resolve);
        });
      } else {
        await this.connection.end();
      }
    }
  }

  async healthCheck() {
    try {
      await this.query('SELECT 1 as health');
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch (error) {
      return { 
        status: 'error', 
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Singleton instance
let dbInstance = null;

module.exports = {
  Database,
  getInstance: () => {
    if (!dbInstance) {
      dbInstance = new Database();
    }
    return dbInstance;
  }
};