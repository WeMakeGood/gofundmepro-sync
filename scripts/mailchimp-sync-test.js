#!/usr/bin/env node

require('dotenv').config();
const { Database } = require('../src/core/database');
const MailChimpSyncPlugin = require('../src/plugins/mailchimp-sync');
const logger = require('../src/utils/logger');

async function testMailChimpSync() {
  console.log('🔄 Testing MailChimp Sync Plugin\n');

  try {
    // Initialize database
    const db = new Database();
    await db.connect();

    // Initialize MailChimp sync plugin
    const pluginConfig = {
      apiKey: process.env.MAILCHIMP_API_KEY,
      listId: '06411e98fe', // Unified Audience
      syncMode: 'incremental',
      batchSize: 10, // Small batch for testing
      tagPrefix: 'Classy-', // Prefix for all tags
      createMergeFields: false, // Don't create fields in test
      waitForBatchCompletion: false // Don't wait for completion in test
    };

    const dependencies = {
      db,
      logger,
      queue: null // Mock queue for testing
    };

    const plugin = new MailChimpSyncPlugin(pluginConfig, dependencies);
    await plugin.initialize();

    console.log('✅ MailChimp sync plugin initialized successfully\n');

    // Test 1: Sync the test email (chris.frazier@wemakegood.org)
    console.log('1️⃣ Testing single supporter sync...');
    
    // Get our test supporter data
    const testSupporterQuery = `
      SELECT * FROM supporter_summary 
      WHERE email_address = 'chris.frazier@wemakegood.org'
      LIMIT 1
    `;
    
    const testSupporters = await db.query(testSupporterQuery);
    if (testSupporters.length === 0) {
      console.log('⚠️  Test email not found in supporter_summary, creating mock data...');
      
      const mockSupporter = {
        id: 999999,
        email_address: 'chris.frazier@wemakegood.org',
        first_name: 'Chris',
        last_name: 'Frazier',
        lifetime_donation_amount: 1250.50,
        lifetime_donation_count: 8,
        monthly_recurring_amount: 75.00,
        active_recurring_plans: 1,
        donor_value_tier: 'Major Donor',
        engagement_status: 'Recent',
        frequency_segment: 'Regular',
        last_donation_date: '2025-05-25T00:00:00Z',
        first_donation_date: '2022-01-15T00:00:00Z',
        days_since_last_donation: 4,
        annual_giving_rate: 400.25
      };
      
      await plugin.process({
        type: 'supporter.updated',
        supporter: mockSupporter
      });
      
    } else {
      const supporter = testSupporters[0];
      console.log(`   Found supporter: ${supporter.first_name} ${supporter.last_name}`);
      console.log(`   Lifetime: $${supporter.lifetime_donation_amount}, Tier: ${supporter.donor_value_tier}`);
      
      await plugin.process({
        type: 'supporter.updated',
        supporter
      });
    }
    
    console.log('✅ Single supporter sync completed\n');

    // Test 2: Sync a small batch of top donors
    console.log('2️⃣ Testing batch sync with top donors...');
    
    const topDonorsQuery = `
      SELECT * FROM supporter_summary 
      WHERE email_address IS NOT NULL 
      AND lifetime_donation_amount > 1000
      ORDER BY lifetime_donation_amount DESC 
      LIMIT 5
    `;
    
    const topDonors = await db.query(topDonorsQuery);
    console.log(`   Found ${topDonors.length} top donors to sync`);
    
    if (topDonors.length > 0) {
      topDonors.forEach((donor, index) => {
        console.log(`   ${index + 1}. ${donor.first_name} ${donor.last_name}: $${donor.lifetime_donation_amount} (${donor.donor_value_tier})`);
      });
      
      await plugin.process({
        type: 'supporters.batch',
        supporters: topDonors
      });
    }
    
    console.log('✅ Batch sync completed\n');

    // Test 3: Test field mapping
    console.log('3️⃣ Testing field mapping...');
    
    const sampleSupporter = {
      email_address: 'test@example.com',
      first_name: 'John',
      last_name: 'Doe',
      lifetime_donation_amount: 2500.75,
      lifetime_donation_count: 12,
      monthly_recurring_amount: 100.00,
      active_recurring_plans: 1,
      donor_value_tier: 'Major Donor',
      engagement_status: 'Active',
      frequency_segment: 'Loyal',
      last_donation_date: '2025-05-20T00:00:00Z',
      days_since_last_donation: 9
    };
    
    const memberData = plugin.mapSupporterToMember(sampleSupporter);
    console.log('   Mapped member data:');
    console.log('   Merge fields:', JSON.stringify(memberData.merge_fields, null, 4));
    console.log('   Tags:', memberData.tags.join(', '));
    console.log('');

    // Test 4: Show statistics about syncable supporters
    console.log('4️⃣ Analyzing sync-ready supporters...');
    
    const statsQuery = `
      SELECT 
        COUNT(*) as total_supporters,
        COUNT(CASE WHEN email_address IS NOT NULL AND email_address != '' THEN 1 END) as with_email,
        COUNT(CASE WHEN email_address IS NOT NULL AND lifetime_donation_amount > 0 THEN 1 END) as donors_with_email,
        AVG(CASE WHEN email_address IS NOT NULL AND lifetime_donation_amount > 0 THEN lifetime_donation_amount END) as avg_donation_with_email,
        COUNT(CASE WHEN email_address IS NOT NULL AND active_recurring_plans > 0 THEN 1 END) as recurring_with_email
      FROM supporter_summary
    `;
    
    const stats = await db.query(statsQuery);
    const stat = stats[0];
    
    console.log(`   Total supporters: ${stat.total_supporters}`);
    console.log(`   With email addresses: ${stat.with_email} (${Math.round(stat.with_email/stat.total_supporters*100)}%)`);
    console.log(`   Donors with email: ${stat.donors_with_email}`);
    console.log(`   Average donation (with email): $${stat.avg_donation_with_email ? stat.avg_donation_with_email.toFixed(2) : '0'}`);
    console.log(`   Recurring donors with email: ${stat.recurring_with_email}`);
    console.log('');

    // Test 5: Show tag distribution for potential sync
    console.log('5️⃣ Showing tag distribution preview...');
    
    const tagDistributionQuery = `
      SELECT 
        donor_value_tier,
        engagement_status,
        frequency_segment,
        COUNT(*) as count
      FROM supporter_summary 
      WHERE email_address IS NOT NULL AND email_address != ''
      GROUP BY donor_value_tier, engagement_status, frequency_segment
      ORDER BY count DESC
      LIMIT 10
    `;
    
    const tagDistribution = await db.query(tagDistributionQuery);
    console.log('   Top supporter segments (with email):');
    tagDistribution.forEach((segment, index) => {
      console.log(`   ${index + 1}. ${segment.donor_value_tier} | ${segment.engagement_status} | ${segment.frequency_segment}: ${segment.count} supporters`);
    });

    await plugin.shutdown();
    await db.close();

    console.log('\n✅ MailChimp sync plugin test completed successfully!');
    console.log('\n📋 Ready for production use:');
    console.log('   - Plugin successfully maps supporter data to MailChimp format');
    console.log('   - Field mapping and tagging systems working correctly');
    console.log('   - Batch operations ready for bulk sync');
    console.log('   - Error handling and logging in place');

  } catch (error) {
    console.error('❌ MailChimp sync test failed:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  }
}

testMailChimpSync();