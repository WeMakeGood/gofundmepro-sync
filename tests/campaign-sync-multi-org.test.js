const CampaignSync = require('../src/classy/entities/campaigns');
const { getInstance: getKnexDatabase } = require('../src/core/knex-database');

describe('CampaignSync Multi-Organization', () => {
  let db;
  let mockApi;

  beforeAll(async () => {
    db = getKnexDatabase();
    await db.connect();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    // Clean up campaigns before each test
    await db.client('campaigns').del();
    await db.client('organizations').del();

    // Create test organization
    await db.client('organizations').insert({
      id: 1,
      classy_id: '64531',
      name: 'Test Organization',
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Create mock API client
    mockApi = {
      getCampaigns: jest.fn()
    };
  });

  describe('Organization Context in Sync Operations', () => {
    test('should pass organization context to API calls', async () => {
      const mockCampaigns = [
        {
          id: 123,
          name: 'Test Campaign',
          status: 'active',
          goal: 1000,
          total_raised: 500,
          donor_count: 10,
          type: 'fundraising',
          started_at: '2024-01-01T00:00:00Z',
          ended_at: '2024-12-31T23:59:59Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T12:00:00Z'
        }
      ];

      mockApi.getCampaigns.mockResolvedValue(mockCampaigns);

      const params = {
        batch_size: 100,
        organization_id: 1,
        classy_organization_id: 64531,
        updated_since: new Date('2024-01-01T00:00:00Z')
      };

      const result = await CampaignSync.incrementalSync(mockApi, db, params);

      // Verify API was called with correct organization ID
      expect(mockApi.getCampaigns).toHaveBeenCalledWith(
        expect.objectContaining({
          per_page: 100,
          sort: 'updated_at:desc'
        }),
        64531 // Classy organization ID
      );

      expect(result.totalRecords).toBe(1);
      expect(result.successfulRecords).toBe(1);
    });

    test('should store campaigns with correct organization_id', async () => {
      const mockCampaigns = [
        {
          id: 123,
          name: 'Test Campaign 1',
          status: 'active',
          goal: 1000,
          type: 'fundraising',
          started_at: '2024-01-01T00:00:00Z',
          ended_at: '2024-12-31T23:59:59Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T12:00:00Z'
        },
        {
          id: 124,
          name: 'Test Campaign 2',
          status: 'published',
          goal: 2000,
          type: 'peer-to-peer',
          started_at: '2024-02-01T00:00:00Z',
          ended_at: '2024-11-30T23:59:59Z',
          created_at: '2024-02-01T00:00:00Z',
          updated_at: '2024-02-15T12:00:00Z'
        }
      ];

      mockApi.getCampaigns.mockResolvedValue(mockCampaigns);

      const params = {
        batch_size: 100,
        organization_id: 1,
        classy_organization_id: 64531,
        updated_since: new Date('2024-01-01T00:00:00Z')
      };

      await CampaignSync.incrementalSync(mockApi, db, params);

      // Verify campaigns were stored with correct organization_id
      const storedCampaigns = await db.client('campaigns').select('*');
      expect(storedCampaigns).toHaveLength(2);

      storedCampaigns.forEach(campaign => {
        expect(campaign.organization_id).toBe(1);
        expect(campaign.classy_id).toBeOneOf(['123', '124']);
      });

      // Verify specific campaign details
      const campaign1 = storedCampaigns.find(c => c.classy_id === '123');
      expect(campaign1.name).toBe('Test Campaign 1');
      expect(campaign1.type).toBe('fundraising');

      const campaign2 = storedCampaigns.find(c => c.classy_id === '124');
      expect(campaign2.name).toBe('Test Campaign 2');
      expect(campaign2.type).toBe('peer-to-peer');
    });

    test('should handle full sync with organization context', async () => {
      const mockCampaigns = Array.from({ length: 25 }, (_, i) => ({
        id: 1000 + i,
        name: `Campaign ${i + 1}`,
        status: 'active',
        goal: 1000 * (i + 1),
        type: 'fundraising',
        started_at: '2024-01-01T00:00:00Z',
        ended_at: '2024-12-31T23:59:59Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-15T12:00:00Z'
      }));

      mockApi.getCampaigns.mockResolvedValue(mockCampaigns);

      const params = {
        batch_size: 50,
        organization_id: 1,
        classy_organization_id: 64531
      };

      const result = await CampaignSync.fullSync(mockApi, db, params);

      expect(result.totalRecords).toBe(25);
      expect(result.successfulRecords).toBe(25);
      expect(result.failedRecords).toBe(0);

      // Verify all campaigns have correct organization_id
      const storedCampaigns = await db.client('campaigns').select('organization_id');
      expect(storedCampaigns).toHaveLength(25);
      storedCampaigns.forEach(campaign => {
        expect(campaign.organization_id).toBe(1);
      });
    });
  });

  describe('Campaign Data Transformation', () => {
    test('should handle API field name mapping correctly', async () => {
      const mockCampaign = {
        id: 123,
        name: 'Field Mapping Test',
        status: 'active',
        goal: 5000,
        total_raised: 2500,
        donor_count: 50,
        type: 'fundraising', // API field name
        started_at: '2024-03-01T00:00:00Z', // API field name
        ended_at: '2024-09-30T23:59:59Z', // API field name
        created_at: '2024-03-01T00:00:00Z',
        updated_at: '2024-03-15T12:00:00Z'
      };

      mockApi.getCampaigns.mockResolvedValue([mockCampaign]);

      const params = {
        organization_id: 1,
        classy_organization_id: 64531,
        updated_since: new Date('2024-01-01T00:00:00Z')
      };

      await CampaignSync.incrementalSync(mockApi, db, params);

      const storedCampaign = await db.client('campaigns').first();
      
      // Verify field mapping from API to database
      expect(storedCampaign.type).toBe('fundraising'); // API 'type' maps to DB 'type'
      expect(storedCampaign.started_at).toBeTruthy(); // API 'started_at' maps to DB 'started_at'
      expect(storedCampaign.ended_at).toBeTruthy(); // API 'ended_at' maps to DB 'ended_at'
      expect(storedCampaign.organization_id).toBe(1);
    });

    test('should handle missing optional fields', async () => {
      const mockCampaign = {
        id: 123,
        name: 'Minimal Campaign',
        status: 'draft',
        goal: 1000,
        type: 'fundraising',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
        // Missing total_raised, donor_count, started_at, ended_at
      };

      mockApi.getCampaigns.mockResolvedValue([mockCampaign]);

      const params = {
        organization_id: 1,
        classy_organization_id: 64531,
        updated_since: new Date('2024-01-01T00:00:00Z')
      };

      const result = await CampaignSync.incrementalSync(mockApi, db, params);

      expect(result.successfulRecords).toBe(1);

      const storedCampaign = await db.client('campaigns').first();
      expect(storedCampaign.name).toBe('Minimal Campaign');
      expect(storedCampaign.total_raised).toBeNull();
      expect(storedCampaign.donor_count).toBeNull();
    });
  });

  describe('Error Handling', () => {
    test('should handle API errors gracefully', async () => {
      mockApi.getCampaigns.mockRejectedValue(new Error('API Connection Failed'));

      const params = {
        organization_id: 1,
        classy_organization_id: 64531,
        updated_since: new Date('2024-01-01T00:00:00Z')
      };

      await expect(CampaignSync.incrementalSync(mockApi, db, params))
        .rejects.toThrow('API Connection Failed');
    });

    test('should handle individual campaign upsert failures', async () => {
      const mockCampaigns = [
        {
          id: 123,
          name: 'Valid Campaign',
          status: 'active',
          goal: 1000,
          type: 'fundraising',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T12:00:00Z'
        },
        {
          id: 124,
          name: null, // Invalid name - will cause upsert to fail
          status: 'active',
          goal: 2000,
          type: 'fundraising',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T12:00:00Z'
        }
      ];

      mockApi.getCampaigns.mockResolvedValue(mockCampaigns);

      const params = {
        organization_id: 1,
        classy_organization_id: 64531,
        updated_since: new Date('2024-01-01T00:00:00Z')
      };

      const result = await CampaignSync.incrementalSync(mockApi, db, params);

      expect(result.totalRecords).toBe(2);
      expect(result.successfulRecords).toBe(1);
      expect(result.failedRecords).toBe(1);

      // Verify only valid campaign was stored
      const storedCampaigns = await db.client('campaigns').select('*');
      expect(storedCampaigns).toHaveLength(1);
      expect(storedCampaigns[0].name).toBe('Valid Campaign');
    });
  });

  describe('Incremental Sync Filtering', () => {
    test('should filter campaigns by update date', async () => {
      const mockCampaigns = [
        {
          id: 123,
          name: 'Recent Campaign',
          status: 'active',
          goal: 1000,
          type: 'fundraising',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-20T12:00:00Z' // After filter date
        },
        {
          id: 124,
          name: 'Old Campaign',
          status: 'active',
          goal: 2000,
          type: 'fundraising',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-05T12:00:00Z' // Before filter date
        }
      ];

      mockApi.getCampaigns.mockResolvedValue(mockCampaigns);

      const params = {
        organization_id: 1,
        classy_organization_id: 64531,
        updated_since: new Date('2024-01-15T00:00:00Z') // Filter date
      };

      const result = await CampaignSync.incrementalSync(mockApi, db, params);

      expect(result.totalRecords).toBe(1); // Only recent campaign
      expect(result.successfulRecords).toBe(1);

      const storedCampaigns = await db.client('campaigns').select('*');
      expect(storedCampaigns).toHaveLength(1);
      expect(storedCampaigns[0].name).toBe('Recent Campaign');
    });
  });
});