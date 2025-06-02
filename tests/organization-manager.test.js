const OrganizationManager = require('../scripts/organization-manager');
const { getInstance: getKnexDatabase } = require('../src/core/knex-database');
const { getInstance: getEncryption } = require('../src/utils/encryption');

describe('OrganizationManager', () => {
  let manager;
  let db;
  let encryption;
  let trx;

  beforeAll(async () => {
    // Set test encryption hash
    process.env.ENCRYPTION_HASH = 'test_hash_for_organization_tests_1234567890123456';
    
    db = getKnexDatabase();
    encryption = getEncryption();
    manager = new OrganizationManager();

    await db.connect();
  });

  afterAll(async () => {
    await manager.close();
    delete process.env.ENCRYPTION_HASH;
  });

  beforeEach(async () => {
    // Start a transaction for test isolation
    trx = await db.client.transaction();
    
    // Replace the manager's database connection with the transaction
    manager.db = { 
      client: trx,
      connect: async () => {}, // No-op since transaction is already connected
      close: async () => {} // No-op to prevent closing transaction early
    };
  });

  afterEach(async () => {
    // Roll back the transaction to undo all changes
    if (trx) {
      await trx.rollback();
    }
  });

  describe('Organization CRUD Operations', () => {
    test('should add organization with encrypted credentials', async () => {
      const config = {
        name: 'Test Organization',
        classy_id: 12345,
        classy_client_id: 'test_client_id',
        classy_client_secret: 'test_client_secret',
        mailchimp_api_key: 'test_mailchimp_key',
        mailchimp_server_prefix: 'us15',
        mailchimp_audience_id: 'audience123',
        description: 'Test organization for unit tests',
        website: 'https://test.org'
      };

      const orgId = await manager.addOrganization(config);

      expect(orgId).toBeGreaterThan(0);

      // Verify organization was created
      const org = await trx('organizations').where({ id: orgId }).first();
      expect(org).toBeTruthy();
      expect(org.name).toBe(config.name);
      expect(org.classy_id).toBe(config.classy_id.toString());

      // Verify credentials are encrypted
      expect(org.custom_fields).toBeTruthy();
      const customFields = JSON.parse(org.custom_fields);
      expect(customFields.api_credentials).toBeTruthy();

      // Verify credentials can be decrypted
      const decrypted = encryption.decryptCredentials(customFields.api_credentials);
      expect(decrypted.classy_client_id).toBe(config.classy_client_id);
      expect(decrypted.classy_client_secret).toBe(config.classy_client_secret);
    });

    test('should prevent duplicate organizations by classy_id', async () => {
      const config = {
        name: 'Test Org 1',
        classy_id: 12345,
        classy_client_id: 'test_id',
        classy_client_secret: 'test_secret'
      };

      await manager.addOrganization(config);

      const duplicateConfig = {
        ...config,
        name: 'Test Org 2' // Different name, same classy_id
      };

      await expect(manager.addOrganization(duplicateConfig))
        .rejects.toThrow('Organization with Classy ID 12345 already exists');
    });

    test('should validate required fields', async () => {
      const incompleteConfig = {
        name: 'Test Org'
        // Missing classy_id and credentials
      };

      await expect(manager.addOrganization(incompleteConfig))
        .rejects.toThrow('Missing required fields');
    });

    test('should list all organizations', async () => {
      // Add test organizations
      await manager.addOrganization({
        name: 'Org 1',
        classy_id: 1001,
        classy_client_id: 'id1',
        classy_client_secret: 'secret1'
      });

      await manager.addOrganization({
        name: 'Org 2',
        classy_id: 1002,
        classy_client_id: 'id2',
        classy_client_secret: 'secret2'
      });

      // Mock console.log to capture output
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await manager.listOrganizations();

      // Verify both organizations are listed
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('🏢 Org 1'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('🏢 Org 2'));

      consoleSpy.mockRestore();
    });

    test('should get organization details', async () => {
      const orgId = await manager.addOrganization({
        name: 'Test Organization',
        classy_id: 12345,
        classy_client_id: 'test_id',
        classy_client_secret: 'test_secret',
        mailchimp_api_key: 'test_mailchimp',
        mailchimp_server_prefix: 'us15'
      });

      const org = await manager.getOrganization(orgId);

      expect(org.name).toBe('Test Organization');
      expect(org.classy_id).toBe('12345');
      expect(org.api_config.has_classy_credentials).toBe(true);
      expect(org.api_config.has_mailchimp_credentials).toBe(true);
    });

    test('should handle missing organization', async () => {
      await expect(manager.getOrganization(999))
        .rejects.toThrow('Organization with ID 999 not found');
    });
  });

  describe('Credential Management', () => {
    test('should handle organization without credentials', async () => {
      // Insert organization without custom_fields using transaction
      const [orgId] = await trx('organizations').insert({
        classy_id: '12345',
        name: 'Test Org',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date()
      });

      const org = await manager.getOrganization(orgId);
      expect(org.api_config).toBeUndefined();
    });

    test('should validate encryption before adding organization', async () => {
      // Temporarily break encryption
      const originalHash = process.env.ENCRYPTION_HASH;
      delete process.env.ENCRYPTION_HASH;

      const config = {
        name: 'Test Org',
        classy_id: 12345,
        classy_client_id: 'test_id',
        classy_client_secret: 'test_secret'
      };

      await expect(manager.addOrganization(config))
        .rejects.toThrow('Encryption validation failed');

      // Restore encryption
      process.env.ENCRYPTION_HASH = originalHash;
    });
  });

  describe('Sync Settings', () => {
    test('should store sync settings with organization', async () => {
      const orgId = await manager.addOrganization({
        name: 'Test Org',
        classy_id: 12345,
        classy_client_id: 'test_id',
        classy_client_secret: 'test_secret',
        mailchimp_api_key: 'test_mailchimp',
        auto_sync_enabled: false,
        sync_interval_minutes: 30
      });

      const org = await manager.getOrganization(orgId);
      expect(org.sync_settings.auto_sync_enabled).toBe(false);
      expect(org.sync_settings.sync_interval_minutes).toBe(30);
      expect(org.sync_settings.mailchimp_sync_enabled).toBe(true);
    });

    test('should use default sync settings', async () => {
      const orgId = await manager.addOrganization({
        name: 'Test Org',
        classy_id: 12345,
        classy_client_id: 'test_id',
        classy_client_secret: 'test_secret'
      });

      const org = await manager.getOrganization(orgId);
      expect(org.sync_settings.auto_sync_enabled).toBe(true);
      expect(org.sync_settings.sync_interval_minutes).toBe(60);
      expect(org.sync_settings.mailchimp_sync_enabled).toBe(false);
    });
  });
});