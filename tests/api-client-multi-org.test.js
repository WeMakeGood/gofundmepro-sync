const ClassyAPIClient = require('../src/classy/api-client');
const { getInstance: getKnexDatabase } = require('../src/core/knex-database');
const { getInstance: getEncryption } = require('../src/utils/encryption');

describe('ClassyAPIClient Multi-Organization', () => {
  let db;
  let encryption;
  let trx;
  
  beforeAll(async () => {
    process.env.ENCRYPTION_HASH = 'test_hash_for_api_client_tests_1234567890123456';
    
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
  });

  afterEach(async () => {
    // Roll back the transaction to undo all changes
    if (trx) {
      await trx.rollback();
    }
  });

  describe('Organization-Specific API Client Creation', () => {
    test('should create API client for organization with credentials', async () => {
      const credentials = {
        classy_client_id: 'test_client_id_123',
        classy_client_secret: 'test_client_secret_456'
      };

      const apiClient = await ClassyAPIClient.createForOrganization(1, credentials);

      expect(apiClient).toBeInstanceOf(ClassyAPIClient);
      expect(apiClient.clientId).toBe(credentials.classy_client_id);
      expect(apiClient.clientSecret).toBe(credentials.classy_client_secret);
      expect(apiClient.organizationId).toBe(1);
    });

    test('should fail without required credentials', async () => {
      const incompleteCredentials = {
        classy_client_id: 'test_id'
        // Missing classy_client_secret
      };

      await expect(ClassyAPIClient.createForOrganization(1, incompleteCredentials))
        .rejects.toThrow('Organization 1 missing Classy API credentials');
    });

    test('should create API client from database organization', async () => {
      // Create organization with encrypted credentials
      const credentials = {
        classy_client_id: 'test_db_client_id',
        classy_client_secret: 'test_db_client_secret',
        mailchimp_api_key: 'test_mailchimp'
      };

      const encryptedCredentials = encryption.encryptCredentials(credentials);
      const customFields = {
        api_credentials: encryptedCredentials,
        sync_settings: { auto_sync_enabled: true }
      };

      const [orgId] = await trx('organizations').insert({
        classy_id: '12345',
        name: 'Test Org',
        status: 'active',
        custom_fields: JSON.stringify(customFields),
        created_at: new Date(),
        updated_at: new Date()
      });

      const testDb = { client: trx };
      const apiClient = await ClassyAPIClient.createFromDatabase(orgId, testDb);

      expect(apiClient).toBeInstanceOf(ClassyAPIClient);
      expect(apiClient.clientId).toBe(credentials.classy_client_id);
      expect(apiClient.clientSecret).toBe(credentials.classy_client_secret);
      expect(apiClient.organizationId).toBe(orgId);
    });

    test('should fail for non-existent organization', async () => {
      const testDb = { client: trx };
      await expect(ClassyAPIClient.createFromDatabase(999, testDb))
        .rejects.toThrow('Organization 999 not found');
    });

    test('should fail for organization without credentials', async () => {
      const [orgId] = await trx('organizations').insert({
        classy_id: '12345',
        name: 'Test Org',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date()
        // No custom_fields
      });

      const testDb = { client: trx };
      await expect(ClassyAPIClient.createFromDatabase(orgId, testDb))
        .rejects.toThrow(`Organization ${orgId} has no API credentials configured`);
    });

    test('should fail for organization with malformed credentials', async () => {
      const [orgId] = await trx('organizations').insert({
        classy_id: '12345',
        name: 'Test Org',
        status: 'active',
        custom_fields: JSON.stringify({ other_data: 'not_credentials' }),
        created_at: new Date(),
        updated_at: new Date()
      });

      const testDb = { client: trx };
      await expect(ClassyAPIClient.createFromDatabase(orgId, testDb))
        .rejects.toThrow(`Organization ${orgId} has no API credentials configured`);
    });
  });

  describe('Organization-Scoped Endpoints', () => {
    let apiClient;

    beforeEach(() => {
      apiClient = new ClassyAPIClient({
        clientId: 'test_id',
        clientSecret: 'test_secret',
        organizationId: 1
      });
    });

    test('should generate organization-scoped endpoint', async () => {
      // Mock getOrganizationIds to avoid API call
      jest.spyOn(apiClient, 'getOrganizationIds').mockResolvedValue([64531]);

      const endpoint = await apiClient.getOrgScopedEndpoint('/campaigns', 64531);
      expect(endpoint).toBe('/2.0/organizations/64531/campaigns');
    });

    test('should auto-discover organization when not provided', async () => {
      // Mock getOrganizationIds to return available organizations
      jest.spyOn(apiClient, 'getOrganizationIds').mockResolvedValue([64531, 64532]);

      const endpoint = await apiClient.getOrgScopedEndpoint('/supporters');
      expect(endpoint).toBe('/2.0/organizations/64531/supporters'); // Uses first available
    });

    test('should handle no available organizations', async () => {
      jest.spyOn(apiClient, 'getOrganizationIds').mockResolvedValue([]);

      await expect(apiClient.getOrgScopedEndpoint('/campaigns'))
        .rejects.toThrow('No organizations available for this API client');
    });
  });

  describe('Configuration Inheritance', () => {
    test('should inherit base configuration', () => {
      const config = {
        clientId: 'test_id',
        clientSecret: 'test_secret',
        organizationId: 123,
        baseURL: 'https://custom.api.url',
        retry: { maxRetries: 5 }
      };

      const apiClient = new ClassyAPIClient(config);

      expect(apiClient.clientId).toBe(config.clientId);
      expect(apiClient.clientSecret).toBe(config.clientSecret);
      expect(apiClient.organizationId).toBe(config.organizationId);
      expect(apiClient.baseURL).toBe(config.baseURL);
    });

    test('should use environment fallbacks', () => {
      process.env.CLASSY_CLIENT_ID = 'env_client_id';
      process.env.CLASSY_CLIENT_SECRET = 'env_client_secret';
      process.env.SYNC_ORGANIZATION_ID = '456';

      const apiClient = new ClassyAPIClient();

      expect(apiClient.clientId).toBe('env_client_id');
      expect(apiClient.clientSecret).toBe('env_client_secret');
      expect(apiClient.organizationId).toBe('456');

      // Clean up
      delete process.env.CLASSY_CLIENT_ID;
      delete process.env.CLASSY_CLIENT_SECRET;
      delete process.env.SYNC_ORGANIZATION_ID;
    });
  });
});