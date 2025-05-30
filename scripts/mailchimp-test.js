#!/usr/bin/env node

require('dotenv').config();
const MailChimpClient = require('../src/integrations/mailchimp-client');

async function testMailChimpOperations() {
  console.log('🧪 Testing MailChimp API Operations\n');

  try {
    // Initialize client - use the discovered list ID from exploration
    const listId = process.env.MAILCHIMP_LIST_ID; // Target MailChimp audience
    const client = new MailChimpClient(process.env.MAILCHIMP_API_KEY, listId);

    // 1. Validate access
    console.log('1️⃣ Validating API access...');
    const validation = await client.validateAccess();
    if (!validation.valid) {
      throw new Error(`Access validation failed: ${validation.error}`);
    }
    console.log(`✅ Connected to: ${validation.account.name}`);
    console.log(`   List: ${validation.list.name} (${validation.list.memberCount} members)`);
    console.log('');

    // 2. Test getting member info for our test email
    console.log('2️⃣ Testing member lookup...');
    const testEmail = 'chris.frazier@wemakegood.org';
    const memberResult = await client.getMember(testEmail);
    
    if (memberResult.exists) {
      console.log(`✅ Found existing member: ${testEmail}`);
      console.log(`   Status: ${memberResult.member.status}`);
      console.log(`   Current merge fields:`, JSON.stringify(memberResult.member.merge_fields, null, 2));
      console.log(`   Current tags: ${memberResult.member.tags ? memberResult.member.tags.map(t => t.name).join(', ') : 'None'}`);
    } else {
      console.log(`ℹ️  Member ${testEmail} not found in list`);
    }
    console.log('');

    // 3. Test updating member with donor data
    console.log('3️⃣ Testing member update with sample donor data...');
    
    // Sample donor data that would come from our supporter_summary
    const sampleDonorData = {
      email_address: testEmail,
      status: 'subscribed',
      merge_fields: {
        FNAME: 'Chris',
        LNAME: 'Frazier',
        TOTALAMT: '500.00', // Sample lifetime amount
        DONCNT: '3', // Sample donation count
        RECAMT: '50.00', // Sample recurring amount
        ACTIVESUB: 'Yes' // Sample active subscription status
      },
      tags: ['Test Donor', 'Major Donor', 'Active', 'API Integration Test']
    };

    const updateResult = await client.upsertMember(sampleDonorData);
    console.log(`✅ Member updated successfully`);
    console.log(`   Email: ${updateResult.email_address}`);
    console.log(`   Status: ${updateResult.status}`);
    console.log(`   Updated merge fields:`, JSON.stringify(updateResult.merge_fields, null, 2));
    console.log('');

    // 4. Test tag operations
    console.log('4️⃣ Testing tag operations...');
    
    // Add some additional tags
    const additionalTags = ['Recent Donor', 'API Test Completed'];
    await client.updateMemberTags(testEmail, additionalTags);
    console.log(`✅ Added tags: ${additionalTags.join(', ')}`);

    // Verify tags were added
    const updatedMember = await client.getMember(testEmail);
    if (updatedMember.exists) {
      const currentTags = updatedMember.member.tags ? updatedMember.member.tags.map(t => t.name) : [];
      console.log(`   Current tags: ${currentTags.join(', ')}`);
    }
    console.log('');

    // 5. Test getting merge fields
    console.log('5️⃣ Testing merge field discovery...');
    const mergeFields = await client.getMergeFields();
    console.log(`Found ${mergeFields.length} merge fields:`);
    mergeFields.forEach(field => {
      console.log(`   ${field.tag}: ${field.name} (${field.type})`);
    });
    console.log('');

    // 6. Test getting available tags
    console.log('6️⃣ Testing tag discovery...');
    const allTags = await client.getTags();
    console.log(`Found ${allTags.length} total tags in list`);
    if (allTags.length > 0) {
      console.log('   Sample tags:', allTags.slice(0, 5).map(t => t.name).join(', '));
      if (allTags.length > 5) {
        console.log(`   ... and ${allTags.length - 5} more`);
      }
    }
    console.log('');

    console.log('✅ All MailChimp API tests completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('   - Create merge fields for additional donor data if needed');
    console.log('   - Design mapping between supporter_summary and MailChimp fields');
    console.log('   - Implement bulk sync functionality');
    console.log('   - Create MailChimp sync plugin for automated updates');

  } catch (error) {
    console.error('❌ MailChimp test failed:', error.message);
    if (error.response?.data) {
      console.error('   API Error Details:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testMailChimpOperations();