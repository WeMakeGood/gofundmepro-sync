const path = require('path');

const databaseConfig = {
  sqlite: {
    client: 'sqlite3',
    connection: {
      filename: process.env.DB_PATH || path.join(__dirname, '../../data/classy.db')
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, '../../migrations')
    }
  },
  
  mysql: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'sync_user',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'classy_sync'
    },
    migrations: {
      directory: path.join(__dirname, '../../migrations')
    }
  }
};

module.exports = {
  development: databaseConfig[process.env.DB_TYPE || 'sqlite'],
  production: databaseConfig[process.env.DB_TYPE || 'sqlite'],
  test: {
    ...databaseConfig.sqlite,
    connection: {
      filename: ':memory:'
    }
  }
};