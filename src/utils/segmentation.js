const logger = require('./logger');

class SegmentationManager {
  constructor(db) {
    this.db = db;
  }

  /**
   * Get all segmentation configs for an organization
   */
  async getSegmentationConfigs(organizationId, segmentType = null) {
    let query = `
      SELECT * FROM donor_segmentation_config 
      WHERE organization_id = ?
    `;
    const params = [organizationId];

    if (segmentType) {
      query += ' AND segment_type = ?';
      params.push(segmentType);
    }

    query += ' ORDER BY segment_type, sort_order';

    return await this.db.query(query, params);
  }

  /**
   * Create or update a segmentation config
   */
  async upsertSegmentationConfig(config) {
    const {
      organizationId,
      segmentType,
      segmentName,
      minAmount = null,
      maxAmount = null,
      minCount = null,
      maxCount = null,
      daysThreshold = null,
      description = '',
      colorCode = '#e0e0e0',
      sortOrder = 0,
      isActive = true
    } = config;

    const query = this.db.type === 'sqlite' ? `
      INSERT OR REPLACE INTO donor_segmentation_config (
        organization_id, segment_type, segment_name, min_amount, max_amount,
        min_count, max_count, days_threshold, description, color_code,
        sort_order, is_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ` : `
      INSERT INTO donor_segmentation_config (
        organization_id, segment_type, segment_name, min_amount, max_amount,
        min_count, max_count, days_threshold, description, color_code,
        sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        min_amount = VALUES(min_amount),
        max_amount = VALUES(max_amount),
        min_count = VALUES(min_count),
        max_count = VALUES(max_count),
        days_threshold = VALUES(days_threshold),
        description = VALUES(description),
        color_code = VALUES(color_code),
        sort_order = VALUES(sort_order),
        is_active = VALUES(is_active),
        updated_at = VALUES(updated_at)
    `;

    const params = [
      organizationId,
      segmentType,
      segmentName,
      minAmount,
      maxAmount,
      minCount,
      maxCount,
      daysThreshold,
      description,
      colorCode,
      sortOrder,
      isActive ? 1 : 0,
      new Date().toISOString()
    ];

    if (this.db.type === 'mysql') {
      params.splice(-1, 0, new Date().toISOString()); // Add created_at for MySQL
    }

    await this.db.query(query, params);
    logger.info('Segmentation config updated', { organizationId, segmentType, segmentName });
  }

  /**
   * Create default donor value segments for an organization
   */
  async createDefaultDonorValueSegments(organizationId, options = {}) {
    const {
      majorDonorThreshold = 1000,
      principalDonorThreshold = 5000,
      transformationalThreshold = 10000
    } = options;

    const segments = [
      {
        segmentName: 'Prospect',
        minAmount: 0,
        maxAmount: 0,
        description: 'No donations yet',
        colorCode: '#e3f2fd',
        sortOrder: 1
      },
      {
        segmentName: 'First-Time',
        minAmount: 0.01,
        maxAmount: 24.99,
        description: 'First donation under $25',
        colorCode: '#bbdefb',
        sortOrder: 2
      },
      {
        segmentName: 'Small Donor',
        minAmount: 25,
        maxAmount: 99.99,
        description: 'Lifetime giving $25-$99',
        colorCode: '#90caf9',
        sortOrder: 3
      },
      {
        segmentName: 'Regular Donor',
        minAmount: 100,
        maxAmount: majorDonorThreshold - 0.01,
        description: `Lifetime giving $100-$${majorDonorThreshold - 1}`,
        colorCode: '#64b5f6',
        sortOrder: 4
      },
      {
        segmentName: 'Major Donor',
        minAmount: majorDonorThreshold,
        maxAmount: principalDonorThreshold - 0.01,
        description: `Lifetime giving $${majorDonorThreshold}-$${principalDonorThreshold - 1}`,
        colorCode: '#2196f3',
        sortOrder: 5
      },
      {
        segmentName: 'Principal Donor',
        minAmount: principalDonorThreshold,
        maxAmount: transformationalThreshold - 0.01,
        description: `Lifetime giving $${principalDonorThreshold}-$${transformationalThreshold - 1}`,
        colorCode: '#1e88e5',
        sortOrder: 6
      },
      {
        segmentName: 'Transformational',
        minAmount: transformationalThreshold,
        maxAmount: null,
        description: `Lifetime giving $${transformationalThreshold}+`,
        colorCode: '#1976d2',
        sortOrder: 7
      }
    ];

    for (const segment of segments) {
      await this.upsertSegmentationConfig({
        organizationId,
        segmentType: 'donor_value',
        ...segment
      });
    }

    logger.info('Default donor value segments created', { 
      organizationId, 
      majorDonorThreshold, 
      principalDonorThreshold, 
      transformationalThreshold 
    });
  }

  /**
   * Get donor value distribution for an organization
   */
  async getDonorValueDistribution(organizationId) {
    const query = `
      SELECT 
        dsc.segment_name,
        dsc.description,
        dsc.color_code,
        COUNT(ss.id) as supporter_count,
        ROUND(SUM(ss.lifetime_donation_amount), 2) as total_lifetime_value,
        ROUND(AVG(ss.lifetime_donation_amount), 2) as avg_lifetime_value,
        ROUND(SUM(ss.monthly_recurring_amount), 2) as total_monthly_recurring,
        ROUND(COUNT(ss.id) * 100.0 / (
          SELECT COUNT(*) FROM supporter_summary 
          WHERE lifetime_donation_amount >= 0
        ), 1) as percentage_of_base
      FROM donor_segmentation_config dsc
      LEFT JOIN supporter_summary ss ON ss.donor_value_tier = dsc.segment_name
      WHERE dsc.segment_type = 'donor_value' 
        AND dsc.organization_id = ?
        AND dsc.is_active = 1
      GROUP BY dsc.segment_name, dsc.sort_order, dsc.description, dsc.color_code
      ORDER BY dsc.sort_order
    `;

    return await this.db.query(query, [organizationId]);
  }

  /**
   * Get supporters by segment
   */
  async getSupportersBySegment(organizationId, segmentType, segmentName, limit = 100) {
    let whereClause;
    switch (segmentType) {
      case 'donor_value':
        whereClause = 'ss.donor_value_tier = ?';
        break;
      case 'engagement':
        whereClause = 'ss.engagement_status = ?';
        break;
      case 'frequency':
        whereClause = 'ss.frequency_segment = ?';
        break;
      default:
        throw new Error(`Unknown segment type: ${segmentType}`);
    }

    const query = `
      SELECT 
        ss.first_name,
        ss.last_name,
        ss.email_address,
        ss.lifetime_donation_amount,
        ss.lifetime_donation_count,
        ss.last_donation_date,
        ss.monthly_recurring_amount,
        ss.donor_value_tier,
        ss.engagement_status,
        ss.frequency_segment
      FROM supporter_summary ss
      WHERE ${whereClause}
      ORDER BY ss.lifetime_donation_amount DESC
      LIMIT ?
    `;

    return await this.db.query(query, [segmentName, limit]);
  }

  /**
   * Generate segmentation report
   */
  async generateSegmentationReport(organizationId) {
    const [valueDistribution, engagementDistribution] = await Promise.all([
      this.getDonorValueDistribution(organizationId),
      this.getEngagementDistribution(organizationId)
    ]);

    const totalDonors = valueDistribution.reduce((sum, segment) => sum + (segment.supporter_count || 0), 0);
    const totalLifetimeValue = valueDistribution.reduce((sum, segment) => sum + (segment.total_lifetime_value || 0), 0);
    const totalMonthlyRecurring = valueDistribution.reduce((sum, segment) => sum + (segment.total_monthly_recurring || 0), 0);

    return {
      summary: {
        totalDonors,
        totalLifetimeValue,
        totalMonthlyRecurring,
        avgLifetimeValue: totalDonors > 0 ? Math.round((totalLifetimeValue / totalDonors) * 100) / 100 : 0
      },
      valueDistribution,
      engagementDistribution,
      generatedAt: new Date().toISOString()
    };
  }

  async getEngagementDistribution(organizationId) {
    // This is a placeholder - the actual engagement distribution would need
    // the view to be updated to properly handle the organization parameter
    return [];
  }
}

module.exports = SegmentationManager;