require('dotenv').config();

module.exports = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: './data/dev_database.sqlite'
    },
    useNullAsDefault: true,
    migrations: {
      directory: './knex_migrations',
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: './knex_seeds'
    }
  },

  production: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4'
    },
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 60000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200
    },
    migrations: {
      directory: './knex_migrations',
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: './knex_seeds'
    }
  },

  // Current environment based on NODE_ENV or DB_TYPE
  current: function() {
    const env = process.env.NODE_ENV || 'development';
    const dbType = process.env.DB_TYPE;
    
    if (dbType === 'mysql') {
      return this.production;
    } else if (dbType === 'sqlite') {
      return this.development;
    } else {
      return this[env] || this.development;
    }
  }
};