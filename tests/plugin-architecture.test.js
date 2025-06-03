/**
 * Plugin Architecture Tests
 * 
 * Test the base plugin system and MailChimp plugin functionality
 */

const { BasePlugin } = require('../src/plugins/base-plugin');
const { MailChimpSyncPlugin } = require('../src/plugins/mailchimp-sync');
const { PluginManager } = require('../src/core/plugin-manager');

// Mock MailChimp client for testing
jest.mock('../src/integrations/mailchimp-client', () => ({
  MailChimpClient: jest.fn().mockImplementation(() => ({
    healthCheck: jest.fn().mockResolvedValue({
      status: 'healthy',
      listName: 'Test List',
      memberCount: 100,
      datacenter: 'us1'
    }),
    batchUpsertMembers: jest.fn().mockResolvedValue({
      success: true,
      processed: 10,
      errors: 0
    })
  }))
}));

describe('Plugin Architecture', () => {
  
  describe('BasePlugin', () => {
    class TestPlugin extends BasePlugin {
      constructor(config, dependencies) {
        super('test-plugin', config, dependencies);
      }

      getRequiredConfigFields() {
        return ['testField'];
      }

      async execute(data, options) {
        return { processed: 1, success: true };
      }
    }

    test('should initialize with valid configuration', async () => {
      const plugin = new TestPlugin({ testField: 'value' });
      
      await plugin.initialize();
      
      expect(plugin.initialized).toBe(true);
      expect(plugin.name).toBe('test-plugin');
    });

    test('should fail initialization with missing required config', async () => {
      const plugin = new TestPlugin({});
      
      await expect(plugin.initialize()).rejects.toThrow('Missing required configuration fields: testField');
    });

    test('should process data successfully', async () => {
      const plugin = new TestPlugin({ testField: 'value' });
      await plugin.initialize();
      
      const result = await plugin.process({ type: 'test' });
      
      expect(result.success).toBe(true);
      expect(result.plugin).toBe('test-plugin');
      expect(result.processed).toBe(1);
    });

    test('should fail processing when not initialized', async () => {
      const plugin = new TestPlugin({ testField: 'value' });
      
      await expect(plugin.process({ type: 'test' })).rejects.toThrow('Plugin test-plugin not initialized');
    });

    test('should perform health check', async () => {
      const plugin = new TestPlugin({ testField: 'value' });
      await plugin.initialize();
      
      const health = await plugin.healthCheck();
      
      expect(health.status).toBe('healthy');
      expect(health.plugin).toBe('test-plugin');
      expect(health.initialized).toBe(true);
    });

    test('should shutdown properly', async () => {
      const plugin = new TestPlugin({ testField: 'value' });
      await plugin.initialize();
      
      await plugin.shutdown();
      
      expect(plugin.initialized).toBe(false);
      expect(plugin.healthStatus).toBe('shutdown');
    });
  });

  describe('MailChimpSyncPlugin', () => {
    const validConfig = {
      apiKey: 'test-key-us1',
      listId: 'test-list-id'
    };

    const mockDb = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(null),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      whereNotNull: jest.fn().mockReturnThis()
    }));

    test('should validate required configuration', () => {
      const plugin = new MailChimpSyncPlugin({}, { database: mockDb });
      const required = plugin.getRequiredConfigFields();
      
      expect(required).toContain('apiKey');
      expect(required).toContain('listId');
    });

    test('should get configuration schema', () => {
      const plugin = new MailChimpSyncPlugin({}, { database: mockDb });
      const schema = plugin.getConfigSchema();
      
      expect(schema.name).toBe('mailchimp');
      expect(schema.description).toBeDefined();
      expect(schema.requiredFields).toContain('apiKey');
      expect(schema.requiredFields).toContain('listId');
      expect(schema.supportedDataTypes).toContain('supporters.sync');
      expect(schema.mergeFields).toBeDefined();
      expect(schema.segmentTags).toBeDefined();
    });

    test('should generate donor segments correctly', async () => {
      const plugin = new MailChimpSyncPlugin(validConfig, { database: mockDb });
      
      // Mock supporter with high lifetime value
      const majorDonor = {
        id: 1,
        organization_id: 1,
        email_address: 'test@example.com',
        first_name: 'John',
        last_name: 'Doe',
        lifetime_donation_amount: 2500,
        lifetime_donation_count: 15,
        monthly_recurring_amount: 100
      };

      const segments = await plugin.generateDonorSegments(majorDonor);
      
      expect(segments).toContain('Major Donor'); // $1K-$5K lifetime
      expect(segments).toContain('Loyal Donor'); // 11-25 donations
      expect(segments).toContain('Monthly Recurring'); // Has recurring
      expect(segments).toContain('$1K+ Lifetime'); // >= $1K
      expect(segments).toContain('$100+ Monthly'); // >= $100 monthly
    });

    test('should convert supporter to MailChimp member format', async () => {
      const mockDbWithTransaction = jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue({
          purchased_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) // 15 days ago
        })
      }));
      
      const plugin = new MailChimpSyncPlugin(validConfig, { database: mockDbWithTransaction });

      const supporter = {
        id: 1,
        organization_id: 1,
        email_address: 'test@example.com',
        first_name: 'John',
        last_name: 'Doe',
        lifetime_donation_amount: 500,
        lifetime_donation_count: 3,
        monthly_recurring_amount: 25
      };

      const member = await plugin.convertSupporterToMember(supporter);
      
      expect(member.email).toBe('test@example.com');
      expect(member.mergeFields.FNAME).toBe('John');
      expect(member.mergeFields.LNAME).toBe('Doe');
      expect(member.mergeFields.TOTALAMT).toBe(500);
      expect(member.mergeFields.DONCNT).toBe(3);
      expect(member.mergeFields.RECAMT).toBe(25);
      expect(member.mergeFields.ACTIVESUB).toBe('Yes');
      expect(member.tags.some(tag => tag.includes('Regular Donor'))).toBe(true);
      expect(member.tags.some(tag => tag.includes('Monthly Recurring'))).toBe(true);
    });
  });

  describe('PluginManager', () => {
    const mockDb = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(null),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      whereNotNull: jest.fn().mockReturnThis()
    }));

    test('should register and initialize plugins', async () => {
      const manager = new PluginManager();
      
      class MockPlugin extends BasePlugin {
        constructor(config) {
          super('mock', config);
        }
        getRequiredConfigFields() { return []; }
        async execute() { return { success: true }; }
      }

      await manager.registerPlugin('mock', MockPlugin, {});
      expect(manager.hasPlugin('mock')).toBe(true);
      expect(manager.getPluginNames()).toContain('mock');

      const results = await manager.initializeAll();
      expect(results.successful).toContain('mock');
      expect(results.failed).toHaveLength(0);
      expect(manager.initialized).toBe(true);
    });

    test('should process data through specific plugin', async () => {
      const manager = new PluginManager();
      
      class MockPlugin extends BasePlugin {
        constructor(config) {
          super('mock', config);
        }
        getRequiredConfigFields() { return []; }
        async execute(data) { 
          return { 
            success: true, 
            processed: data.items?.length || 1 
          }; 
        }
      }

      await manager.registerPlugin('mock', MockPlugin, {});
      await manager.initializeAll();

      const result = await manager.processWithPlugin('mock', { 
        type: 'test', 
        items: [1, 2, 3] 
      });

      expect(result.success).toBe(true);
      expect(result.plugin).toBe('mock');
      expect(result.processed).toBe(3);
    });

    test('should get health status for all plugins', async () => {
      const manager = new PluginManager();
      
      class MockPlugin extends BasePlugin {
        constructor(config) {
          super('mock', config);
        }
        getRequiredConfigFields() { return []; }
        async execute() { return { success: true }; }
      }

      await manager.registerPlugin('mock', MockPlugin, {});
      await manager.initializeAll();

      const health = await manager.getHealthStatus();
      
      expect(health.manager.status).toBe('healthy');
      expect(health.plugins.mock.status).toBe('healthy');
    });

    test('should shutdown all plugins', async () => {
      const manager = new PluginManager();
      
      class MockPlugin extends BasePlugin {
        constructor(config) {
          super('mock', config);
        }
        getRequiredConfigFields() { return []; }
        async execute() { return { success: true }; }
      }

      await manager.registerPlugin('mock', MockPlugin, {});
      await manager.initializeAll();

      const results = await manager.shutdownAll();
      
      expect(results.successful).toContain('mock');
      expect(results.failed).toHaveLength(0);
      expect(manager.initialized).toBe(false);
    });

    test('should create default manager with MailChimp', async () => {
      const manager = await PluginManager.createDefault({
        mailchimp: {
          apiKey: 'test-key-us1',
          listId: 'test-list'
        },
        dependencies: {
          database: mockDb
        }
      });

      expect(manager.hasPlugin('mailchimp')).toBe(true);
    });
  });
});