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

  // Complete donor segmentation configuration with behavioral rules
  await knex('donor_segmentation_config').insert([
    // VALUE-BASED SEGMENTATION
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Prospect',
      min_amount: 0,
      max_amount: 0,
      description: 'Individuals who have not yet made a donation',
      color_code: '#e0e0e0',
      sort_order: 1
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'First-Time',
      min_amount: 0.01,
      max_amount: 24.99,
      description: 'New donors with small initial gifts',
      color_code: '#c8e6c9',
      sort_order: 2
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Small Donor',
      min_amount: 25,
      max_amount: 99.99,
      description: 'Small but meaningful donors',
      color_code: '#a5d6a7',
      sort_order: 3
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Regular Donor',
      min_amount: 100,
      max_amount: 499.99,
      description: 'Consistent mid-level supporters',
      color_code: '#81c784',
      sort_order: 4
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Committed Donor',
      min_amount: 500,
      max_amount: 999.99,
      description: 'Committed supporters with significant gifts',
      color_code: '#66bb6a',
      sort_order: 5
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Major Donor',
      min_amount: 1000,
      max_amount: 4999.99,
      description: 'Major gift donors requiring stewardship',
      color_code: '#4caf50',
      sort_order: 6
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Principal Donor',
      min_amount: 5000,
      max_amount: 9999.99,
      description: 'Principal gift donors with high capacity',
      color_code: '#43a047',
      sort_order: 7
    },
    {
      organization_id: orgId,
      segment_type: 'donor_value',
      segment_name: 'Transformational',
      min_amount: 10000,
      max_amount: null,
      description: 'Transformational donors with exceptional commitment',
      color_code: '#388e3c',
      sort_order: 8
    },

    // ENGAGEMENT-BASED SEGMENTATION (based on days since last donation)
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Recent',
      days_threshold: 30,
      description: 'Donated in last 30 days - highly engaged',
      color_code: '#4caf50',
      sort_order: 1
    },
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Active',
      days_threshold: 90,
      description: 'Donated in last 31-90 days - actively engaged',
      color_code: '#8bc34a',
      sort_order: 2
    },
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Warm',
      days_threshold: 180,
      description: 'Donated in last 91-180 days - warm relationship',
      color_code: '#cddc39',
      sort_order: 3
    },
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Cooling',
      days_threshold: 365,
      description: 'Donated in last 181-365 days - needs re-engagement',
      color_code: '#ffeb3b',
      sort_order: 4
    },
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Lapsed',
      days_threshold: 730,
      description: 'Donated 1-2 years ago - lapsed supporter',
      color_code: '#ff9800',
      sort_order: 5
    },
    {
      organization_id: orgId,
      segment_type: 'engagement',
      segment_name: 'Dormant',
      days_threshold: null,
      description: 'Donated 2+ years ago - dormant relationship',
      color_code: '#f44336',
      sort_order: 6
    },

    // FREQUENCY-BASED SEGMENTATION (based on number of donations)
    {
      organization_id: orgId,
      segment_type: 'frequency',
      segment_name: 'One-Time',
      min_count: 1,
      max_count: 1,
      description: 'Single donation - potential for cultivation',
      color_code: '#9e9e9e',
      sort_order: 1
    },
    {
      organization_id: orgId,
      segment_type: 'frequency',
      segment_name: 'Repeat',
      min_count: 2,
      max_count: 3,
      description: '2-3 donations - developing relationship',
      color_code: '#607d8b',
      sort_order: 2
    },
    {
      organization_id: orgId,
      segment_type: 'frequency',
      segment_name: 'Regular',
      min_count: 4,
      max_count: 10,
      description: '4-10 donations - regular supporter',
      color_code: '#795548',
      sort_order: 3
    },
    {
      organization_id: orgId,
      segment_type: 'frequency',
      segment_name: 'Loyal',
      min_count: 11,
      max_count: 25,
      description: '11-25 donations - loyal supporter',
      color_code: '#5d4037',
      sort_order: 4
    },
    {
      organization_id: orgId,
      segment_type: 'frequency',
      segment_name: 'Champion',
      min_count: 26,
      max_count: null,
      description: '26+ donations - champion supporter',
      color_code: '#3e2723',
      sort_order: 5
    }
  ]);

  console.log('✅ Complete donor segmentation config seeded successfully');
  console.log('   📊 Value-based: 8 tiers (Prospect → Transformational)');
  console.log('   ⏰ Engagement-based: 6 levels (Recent → Dormant)');
  console.log('   🔄 Frequency-based: 5 segments (One-Time → Champion)');
};