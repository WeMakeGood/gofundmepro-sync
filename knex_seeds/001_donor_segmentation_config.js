/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  // Deletes ALL existing entries
  await knex('donor_segmentation_config').del();

  // Note: Organizations should be created via CLI (npm run org:add) 
  // This seed only creates default segmentation config when organizations exist
  
  // Check if any organizations exist, if not skip seeding
  const orgs = await knex('organizations').select('id');
  if (orgs.length === 0) {
    console.log('No organizations found - skipping donor segmentation config seeding');
    console.log('Use "npm run org:add" to create an organization first');
    return;
  }

  // Use the first organization for default segmentation config
  const orgId = orgs[0].id;

  // Insert donor value tiers
  await knex('donor_segmentation_config').insert([
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Prospect',
      min_amount: 0,
      max_amount: 0,
      description: 'No donations yet',
      color_code: '#e3f2fd',
      sort_order: 1
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'First-Time',
      min_amount: 0.01,
      max_amount: 24.99,
      description: 'First donation under $25',
      color_code: '#bbdefb',
      sort_order: 2
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Small Donor',
      min_amount: 25,
      max_amount: 99.99,
      description: 'Lifetime giving $25-$99',
      color_code: '#90caf9',
      sort_order: 3
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Regular Donor',
      min_amount: 100,
      max_amount: 499.99,
      description: 'Lifetime giving $100-$499',
      color_code: '#64b5f6',
      sort_order: 4
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Committed Donor',
      min_amount: 500,
      max_amount: 999.99,
      description: 'Lifetime giving $500-$999',
      color_code: '#42a5f5',
      sort_order: 5
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Major Donor',
      min_amount: 1000,
      max_amount: 4999.99,
      description: 'Lifetime giving $1K-$4.9K',
      color_code: '#2196f3',
      sort_order: 6
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Principal Donor',
      min_amount: 5000,
      max_amount: 9999.99,
      description: 'Lifetime giving $5K-$9.9K',
      color_code: '#1e88e5',
      sort_order: 7
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Transformational',
      min_amount: 10000,
      max_amount: null,
      description: 'Lifetime giving $10K+',
      color_code: '#1976d2',
      sort_order: 8
    }
  ]);

  // Insert engagement-based segments
  await knex('donor_segmentation_config').insert([
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Recent',
      days_threshold: 30,
      description: 'Donated in last 30 days',
      color_code: '#4caf50',
      sort_order: 1
    },
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Active',
      days_threshold: 90,
      description: 'Donated in last 31-90 days',
      color_code: '#8bc34a',
      sort_order: 2
    },
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Warm',
      days_threshold: 180,
      description: 'Donated in last 91-180 days',
      color_code: '#cddc39',
      sort_order: 3
    },
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Cooling',
      days_threshold: 365,
      description: 'Donated in last 181-365 days',
      color_code: '#ffeb3b',
      sort_order: 4
    },
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Lapsed',
      days_threshold: 730,
      description: 'Donated 1-2 years ago',
      color_code: '#ff9800',
      sort_order: 5
    },
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Dormant',
      days_threshold: null,
      description: 'Donated 2+ years ago',
      color_code: '#f44336',
      sort_order: 6
    }
  ]);

  // Insert frequency-based segments
  await knex('donor_segmentation_config').insert([
    {
      organization_id: orgId,
      segment_type: 'frequency',
      segment_name: 'One-Time',
      min_count: 1,
      max_count: 1,
      description: 'Single donation',
      color_code: '#9e9e9e',
      sort_order: 1
    },
    {
      organization_id: orgId,
      segment_type: 'frequency',
      segment_name: 'Repeat',
      min_count: 2,
      max_count: 3,
      description: '2-3 donations',
      color_code: '#607d8b',
      sort_order: 2
    },
    {
      organization_id: orgId,
      segment_type: 'frequency',
      segment_name: 'Regular',
      min_count: 4,
      max_count: 10,
      description: '4-10 donations',
      color_code: '#795548',
      sort_order: 3
    },
    {
      organization_id: orgId,
      segment_type: 'frequency',
      segment_name: 'Loyal',
      min_count: 11,
      max_count: 25,
      description: '11-25 donations',
      color_code: '#5d4037',
      sort_order: 4
    },
    {
      organization_id: orgId,
      segment_type: 'frequency',
      segment_name: 'Champion',
      min_count: 26,
      max_count: null,
      description: '26+ donations',
      color_code: '#3e2723',
      sort_order: 5
    }
  ]);
};