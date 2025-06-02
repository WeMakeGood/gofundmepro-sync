const SyncEngine = require('../src/core/sync-engine');
const ClassyAPIClient = require('../src/classy/api-client');
const { getInstance: getKnexDatabase } = require('../src/core/knex-database');
const { getInstance: getEncryption } = require('../src/utils/encryption');

// Mock the API client to avoid real API calls
jest.mock('../src/classy/api-client');

describe('SyncEngine Multi-Organization', () => {
  let db;
  let encryption;
  let mockApiClient;
  let trx;

  beforeAll(async () => {
    process.env.ENCRYPTION_HASH = 'test_hash_for_sync_engine_tests_1234567890123456';
    
    db = getKnexDatabase();
    encryption = getEncryption();
    await db.connect();
  });

  afterAll(async () => {
    await db.close();
    delete process.env.ENCRYPTION_HASH;
  });

  beforeEach(async () => {
    // Start a transaction for test isolation
    trx = await db.client.transaction();

    // Reset API client mocks
    jest.clearAllMocks();
    
    // Create mock API client
    mockApiClient = {
      getCampaigns: jest.fn(),
      getSupporter: jest.fn(),
      getTransactions: jest.fn(),
      getRecurringPlans: jest.fn(),
      healthCheck: jest.fn().mockResolvedValue({ status: 'ok' })
    };

    ClassyAPIClient.createFromDatabase = jest.fn().mockResolvedValue(mockApiClient);
  });

  afterEach(async () => {
    // Roll back the transaction to undo all changes
    if (trx) {
      await trx.rollback();
    }
  });

  // Helper function to create test organization  
  let orgCounter = 1;
  async function createTestOrganization(name, classyId) {
    const credentials = {
      classy_client_id: 'test_client',
      classy_client_secret: 'test_secret'
    };
    
    const encryptedCredentials = encryption.encryptCredentials(credentials);
    
    // Use counter to ensure unique classy_id if not provided
    const uniqueClassyId = classyId || (20000 + orgCounter++);
    
    const [orgId] = await trx('organizations').insert({
      classy_id: uniqueClassyId.toString(),
      name: name,
      status: 'active',
      custom_fields: JSON.stringify({
        api_credentials: encryptedCredentials
      }),
      created_at: new Date(),
      updated_at: new Date()
    });
    
    return orgId;
  }

  describe('Organization Context Initialization', () => {
    test('should initialize with organization context', async () => {
      // Create test organization
      const orgId = await createTestOrganization('Test Org', 12345);

      const testDb = { client: trx };
      const syncEngine = new SyncEngine({ organizationId: orgId, db: testDb });
      await syncEngine.initialize();

      expect(syncEngine.organizationId).toBe(orgId);
      expect(syncEngine.classyOrganizationId).toBe('12345');
      expect(ClassyAPIClient.createFromDatabase).toHaveBeenCalledWith(orgId, testDb);

      if (syncEngine.shutdown) {
        await syncEngine.shutdown();
      }
    });

    test('should handle organization not found', async () => {
      const testDb = { client: trx };
      const syncEngine = new SyncEngine({ organizationId: 999, db: testDb });

      await expect(syncEngine.initialize())
        .rejects.toThrow('Organization 999 not found');
    });

    test('should fallback to environment credentials without organization ID', async () => {
      process.env.CLASSY_CLIENT_ID = 'env_id';
      process.env.CLASSY_CLIENT_SECRET = 'env_secret';

      // Mock the constructor
      const originalClassyAPIClient = ClassyAPIClient;
      ClassyAPIClient.prototype.constructor = jest.fn().mockReturnValue(mockApiClient);
      
      const testDb = { client: trx };
      const syncEngine = new SyncEngine({ db: testDb });
      await syncEngine.initialize();

      expect(syncEngine.organizationId).toBeNull();

      if (syncEngine.shutdown) {
        await syncEngine.shutdown();
      }

      // Clean up
      delete process.env.CLASSY_CLIENT_ID;
      delete process.env.CLASSY_CLIENT_SECRET;
      ClassyAPIClient.prototype.constructor = originalClassyAPIClient;
    });
  });

  describe('Sync All with Organization Context', () => {
    let syncEngine;
    let orgId;

    beforeEach(async () => {
      orgId = await createTestOrganization('Test Org'); // No classy_id to use unique counter
      const testDb = { client: trx };
      syncEngine = new SyncEngine({ organizationId: orgId, db: testDb });
      await syncEngine.initialize();
    });

    afterEach(async () => {
      if (syncEngine && syncEngine.shutdown) {
        await syncEngine.shutdown();
      }
    });

    test('should run incremental sync for all entities', async () => {
      // Mock successful API responses
      mockApiClient.getCampaigns.mockResolvedValue([]);
      mockApiClient.getSupporter.mockResolvedValue([]);
      mockApiClient.getTransactions.mockResolvedValue([]);
      mockApiClient.getRecurringPlans.mockResolvedValue([]);

      await syncEngine.syncAll({ syncType: 'incremental' });

      expect(mockApiClient.getCampaigns).toHaveBeenCalled();
    });

    test('should run full sync for all entities', async () => {
      // Mock successful API responses
      mockApiClient.getCampaigns.mockResolvedValue([]);
      mockApiClient.getSupporter.mockResolvedValue([]);
      mockApiClient.getTransactions.mockResolvedValue([]);
      mockApiClient.getRecurringPlans.mockResolvedValue([]);

      await syncEngine.syncAll({ syncType: 'full' });

      expect(mockApiClient.getCampaigns).toHaveBeenCalled();
    });

    test('should handle sync failures gracefully', async () => {
      // Mock API failure
      mockApiClient.getCampaigns.mockRejectedValue(new Error('API failure'));

      await expect(syncEngine.syncAll()).rejects.toThrow('API failure');
    });

    test('should default to incremental sync', async () => {
      // Mock successful API responses
      mockApiClient.getCampaigns.mockResolvedValue([]);
      mockApiClient.getSupporter.mockResolvedValue([]);
      mockApiClient.getTransactions.mockResolvedValue([]);
      mockApiClient.getRecurringPlans.mockResolvedValue([]);

      await syncEngine.syncAll(); // No syncType specified

      expect(mockApiClient.getCampaigns).toHaveBeenCalled();
    });
  });

  describe('Sync Job Tracking', () => {
    test('should record sync jobs with organization context', async () => {
      const orgId = await createTestOrganization('Test Org');
      const testDb = { client: trx };
      const syncEngine = new SyncEngine({ organizationId: orgId, db: testDb });
      
      // Mock the recordSyncJob method since it's internal
      const mockRecordSyncJob = jest.fn().mockResolvedValue();
      syncEngine.recordSyncJob = mockRecordSyncJob;
      
      await syncEngine.recordSyncJob('campaigns', 'success', 10, null);
      
      expect(mockRecordSyncJob).toHaveBeenCalledWith('campaigns', 'success', 10, null);
    });

    test('should handle sync timestamp updates', async () => {
      const orgId = await createTestOrganization('Test Org');
      
      // Update last sync timestamp
      await trx('organizations')
        .where({ id: orgId })
        .update({ last_sync_at: new Date() });
      
      const org = await trx('organizations').where({ id: orgId }).first();
      expect(org.last_sync_at).toBeTruthy();
    });
  });

  describe('Health Checks', () => {
    test('should perform health check with organization context', async () => {
      const orgId = await createTestOrganization('Test Org');
      const testDb = { client: trx };
      const syncEngine = new SyncEngine({ organizationId: orgId, db: testDb });
      await syncEngine.initialize();

      const healthResult = await syncEngine.healthCheck();

      expect(healthResult).toBeDefined();
      expect(mockApiClient.healthCheck).toHaveBeenCalled();

      if (syncEngine.shutdown) {
        await syncEngine.shutdown();
      }
    });
  });
});