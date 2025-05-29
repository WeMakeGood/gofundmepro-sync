#!/usr/bin/env node

require('dotenv').config();
const { Database } = require('../src/core/database');
const SegmentationManager = require('../src/utils/segmentation');

async function demonstrateSegmentation() {
  console.log('🎯 Donor Segmentation Flexibility Demo\n');

  try {
    const db = new Database();
    await db.connect();
    
    const segmentation = new SegmentationManager(db);

    // Show current Eden Projects segmentation
    console.log('📊 Current Eden Projects Donor Value Distribution:');
    const currentDistribution = await segmentation.getDonorValueDistribution(1);
    
    currentDistribution.forEach(segment => {
      console.log(`  ${segment.segment_name}: ${segment.supporter_count} supporters ($${segment.total_lifetime_value} lifetime, $${segment.total_monthly_recurring}/mo recurring)`);
    });

    console.log('\n💡 Creating alternative segmentation for a different org type...\n');

    // Demonstrate creating segments for a different organization type
    // (e.g., a smaller nonprofit where $100 might be considered major giving)
    
    console.log('📝 Example: Small Local Nonprofit Segmentation (Major Donor starts at $100):');
    
    // This would be for organization ID 2 (hypothetical)
    const smallNonprofitSegments = [
      { segmentName: 'Prospect', minAmount: 0, maxAmount: 0, description: 'No donations yet' },
      { segmentName: 'First-Time', minAmount: 0.01, maxAmount: 9.99, description: 'First donation under $10' },
      { segmentName: 'Small Donor', minAmount: 10, maxAmount: 24.99, description: 'Lifetime giving $10-$24' },
      { segmentName: 'Regular Donor', minAmount: 25, maxAmount: 99.99, description: 'Lifetime giving $25-$99' },
      { segmentName: 'Major Donor', minAmount: 100, maxAmount: 499.99, description: 'Lifetime giving $100-$499' },
      { segmentName: 'Principal Donor', minAmount: 500, maxAmount: 999.99, description: 'Lifetime giving $500-$999' },
      { segmentName: 'Transformational', minAmount: 1000, maxAmount: null, description: 'Lifetime giving $1000+' }
    ];

    smallNonprofitSegments.forEach((segment, index) => {
      console.log(`  ${segment.segmentName}: ${segment.description}`);
    });

    console.log('\n🎨 Example: Healthcare Foundation Segmentation (Major Donor starts at $10K):');
    
    const healthcareFoundationSegments = [
      { segmentName: 'Prospect', minAmount: 0, maxAmount: 0, description: 'No donations yet' },
      { segmentName: 'Supporter', minAmount: 0.01, maxAmount: 99.99, description: 'Under $100 lifetime' },
      { segmentName: 'Friend', minAmount: 100, maxAmount: 499.99, description: '$100-$499 lifetime' },
      { segmentName: 'Advocate', minAmount: 500, maxAmount: 999.99, description: '$500-$999 lifetime' },
      { segmentName: 'Partner', minAmount: 1000, maxAmount: 4999.99, description: '$1K-$4.9K lifetime' },
      { segmentName: 'Champion', minAmount: 5000, maxAmount: 9999.99, description: '$5K-$9.9K lifetime' },
      { segmentName: 'Major Donor', minAmount: 10000, maxAmount: 49999.99, description: '$10K-$49.9K lifetime' },
      { segmentName: 'Principal Donor', minAmount: 50000, maxAmount: 99999.99, description: '$50K-$99.9K lifetime' },
      { segmentName: 'Transformational', minAmount: 100000, maxAmount: null, description: '$100K+ lifetime' }
    ];

    healthcareFoundationSegments.forEach((segment, index) => {
      console.log(`  ${segment.segmentName}: ${segment.description}`);
    });

    console.log('\n🔧 To implement different segmentation for another organization:');
    console.log('1. Create the organization record');
    console.log('2. Use SegmentationManager.createDefaultDonorValueSegments(orgId, { majorDonorThreshold: 100 })');
    console.log('3. Or manually configure with SegmentationManager.upsertSegmentationConfig()');
    console.log('4. The supporter_summary view will automatically use the configured segments');

    console.log('\n✅ Current system separates:');
    console.log('  📈 Donor Value Tiers (lifetime giving amount)');
    console.log('  🕒 Engagement Status (recency of last gift)');  
    console.log('  🔄 Frequency Segments (total number of gifts)');
    console.log('\n💡 This separation makes analysis clearer and avoids mixing different behavioral indicators!');

    await db.close();

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
  }
}

demonstrateSegmentation();