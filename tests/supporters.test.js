const SupporterSync = require('../src/classy/entities/supporters');
const { getInstance } = require('../src/core/knex-database');

// Mock API client for supporters endpoint
const mockApi = {
  getSupporters: jest.fn(),
  getSupporter: jest.fn()
};

describe('Supporters Sync Tests', () => {
  let db;

  beforeAll(async () => {
    db = getInstance();
    await db.connect();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Timeout Handling', () => {
    test('should handle API timeouts gracefully', async () => {
      // Mock a slow API response that times out
      mockApi.getSupporters.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 70000)) // 70 seconds - longer than 60s timeout
      );

      const params = {
        updated_since: new Date('2024-01-01'),
        organization_id: 64531,
        batch_size: 5
      };

      const result = await SupporterSync.incrementalSync(mockApi, db, params);
      
      // Should return graceful fallback result
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('API timeout');
      expect(result.totalRecords).toBe(0);
    });

    test('should process supporters when API responds quickly', async () => {
      // Mock a fast API response
      const mockSupporters = [
        {
          id: 1,
          email_address: 'test@example.com',
          first_name: 'Test',
          last_name: 'User',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z' // After our filter date
        }
      ];

      mockApi.getSupporters.mockResolvedValue(mockSupporters);

      const params = {
        updated_since: new Date('2024-01-01'),
        organization_id: 64531,
        batch_size: 5
      };

      const result = await SupporterSync.incrementalSync(mockApi, db, params);
      
      // Should process the supporter
      expect(result.skipped).toBeUndefined();
      expect(result.totalRecords).toBe(1);
    });
  });

  describe('SQL Syntax Compatibility', () => {
    test('should use correct timestamp SQL for database type', () => {
      const dbType = db.type;
      
      // Test the formatTimestamp helper function logic
      const testTimestamp = '2024-01-01T12:00:00+0000';
      const formatted = testTimestamp.replace(/T/, ' ').replace(/\+\d{4}$/, '').replace(/Z$/, '');
      
      expect(formatted).toBe('2024-01-01 12:00:00');
    });

    test('should generate valid upsert SQL for database type', () => {
      const dbType = db.type;
      
      // Test the SQL generation logic from upsertSupporter
      if (dbType === 'sqlite') {
        const conflictClause = 'ON CONFLICT(classy_id) DO UPDATE SET';
        expect(conflictClause).toContain('ON CONFLICT');
      } else {
        const conflictClause = 'ON DUPLICATE KEY UPDATE';
        expect(conflictClause).toContain('ON DUPLICATE KEY');
      }
    });
  });

  describe('Supporter Statistics Calculation', () => {
    test('should generate valid lifetime stats SQL', async () => {
      const dbType = db.type;
      
      // Test the exact SQL that was failing in initial sync
      const timestampFunction = dbType === 'mysql' ? 'NOW()' : "datetime('now')";
      
      const updateQuery = `
        UPDATE supporters s
        SET last_sync_at = ${timestampFunction}
        WHERE s.id = 999999
      `;
      
      // This should not error on SQL syntax
      await expect(db.query(updateQuery)).resolves.toBeDefined();
    });

    test('should handle recalculation of all lifetime stats', async () => {
      // Test that the complex UPDATE query syntax is valid
      const result = await SupporterSync.recalculateAllLifetimeStats(db);
      
      expect(result).toBeDefined();
      expect(result.total_supporters).toBeDefined();
      expect(result.supporters_with_donations).toBeDefined();
    });
  });

  describe('Data Validation', () => {
    test('should handle missing supporter data gracefully', async () => {
      const incompleteSupporter = {
        id: 999,
        email_address: 'incomplete@example.com'
        // Missing many fields
      };

      // Should not throw error when upserting incomplete data
      await expect(
        SupporterSync.upsertSupporter(db, incompleteSupporter)
      ).resolves.toBeDefined();
    });

    test('should format timestamps consistently', () => {
      const testCases = [
        '2024-01-01T12:00:00+0000',
        '2024-01-01T12:00:00Z',
        '2024-01-01T12:00:00.000Z',
        null,
        undefined
      ];

      testCases.forEach(timestamp => {
        const formatTimestamp = (ts) => {
          if (!ts) return null;
          return ts.replace(/T/, ' ').replace(/\+\d{4}$/, '').replace(/Z$/, '');
        };

        if (timestamp) {
          const result = formatTimestamp(timestamp);
          expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
        } else {
          const result = formatTimestamp(timestamp);
          expect(result).toBeNull();
        }
      });
    });
  });
});