const { getInstance } = require('../src/core/knex-database');

describe('Database Layer Tests', () => {
  let db;

  beforeAll(async () => {
    db = getInstance();
    await db.connect();
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Database Type Detection', () => {
    test('should detect correct database type', () => {
      const dbType = db.type;
      expect(['mysql', 'sqlite', 'pg']).toContain(dbType);
    });

    test('should provide SQL syntax compatibility', () => {
      const dbType = db.type;
      
      // Test timestamp functions for each database type
      const timestampFunctions = {
        mysql: 'NOW()',
        sqlite: "datetime('now')",
        pg: 'NOW()'
      };
      
      expect(timestampFunctions[dbType]).toBeDefined();
    });
  });

  describe('Database Connection', () => {
    test('should connect successfully', async () => {
      expect(db.connected).toBe(true);
      expect(db.knex).toBeDefined();
    });

    test('should execute basic queries', async () => {
      const result = await db.query('SELECT 1 as test');
      expect(result).toBeDefined();
      expect(result[0].test).toBe(1);
    });

    test('should handle health checks', async () => {
      const health = await db.healthCheck();
      expect(health.status).toBe('ok');
      expect(health.connected).toBe(true);
      expect(health.type).toBeDefined();
    });
  });

  describe('Database Operations', () => {
    test('should handle parameterized queries safely', async () => {
      const testValue = 'test_value';
      const result = await db.query('SELECT ? as param_test', [testValue]);
      expect(result[0].param_test).toBe(testValue);
    });

    test('should support timestamp operations', async () => {
      const timestampQuery = db.type === 'mysql' ? 'SELECT NOW() as `current_time`' : 
                           db.type === 'sqlite' ? "SELECT datetime('now') as current_time" :
                           'SELECT NOW() as current_time';
      
      const result = await db.query(timestampQuery);
      expect(result[0].current_time).toBeDefined();
    });
  });
});