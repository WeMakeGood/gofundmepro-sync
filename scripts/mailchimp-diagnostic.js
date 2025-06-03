/**
 * MailChimp Diagnostic Script
 * 
 * Basic connectivity test and list discovery
 */

// Load environment variables
require('dotenv').config();

const { MailChimpClient } = require('../src/integrations/mailchimp-client');
const { createLogger } = require('../src/utils/logger');

const logger = createLogger('mailchimp-diagnostic');

async function diagnosticTest() {
  try {
    if (!process.env.MAILCHIMP_API_KEY) {
      console.log('❌ MAILCHIMP_API_KEY not set in environment');
      return;
    }

    if (!process.env.MAILCHIMP_LIST_ID) {
      console.log('❌ MAILCHIMP_LIST_ID not set in environment');
      return;
    }

    console.log('🔍 MailChimp Diagnostic Test');
    console.log('API Key:', process.env.MAILCHIMP_API_KEY.substring(0, 10) + '...');
    console.log('List ID:', process.env.MAILCHIMP_LIST_ID);

    // Extract datacenter
    const datacenter = process.env.MAILCHIMP_API_KEY.split('-')[1];
    console.log('Datacenter:', datacenter);

    // Create client with minimal config for testing
    const testClient = new MailChimpClient({
      apiKey: process.env.MAILCHIMP_API_KEY,
      listId: process.env.MAILCHIMP_LIST_ID
    });

    // Test basic connectivity
    console.log('\n📡 Testing API connectivity...');
    try {
      const pingResponse = await testClient.axios.get('/ping');
      console.log('✅ API connectivity successful');
      console.log('Response:', pingResponse.data);
    } catch (error) {
      console.log('❌ API connectivity failed:', error.message);
      return;
    }

    // List all available lists
    console.log('\n📋 Discovering available lists...');
    try {
      const listsResponse = await testClient.axios.get('/lists');
      const lists = listsResponse.data.lists || [];
      
      console.log(`Found ${lists.length} lists:`);
      lists.forEach((list, index) => {
        console.log(`${index + 1}. ${list.name} (ID: ${list.id})`);
        console.log(`   Members: ${list.stats.member_count}`);
        console.log(`   Created: ${new Date(list.date_created).toLocaleDateString()}`);
        
        if (list.id === process.env.MAILCHIMP_LIST_ID) {
          console.log('   ⭐ This is the configured list');
        }
        console.log('');
      });

      // Try to access the configured list
      console.log(`🎯 Testing access to configured list (${process.env.MAILCHIMP_LIST_ID})...`);
      try {
        const listResponse = await testClient.axios.get(`/lists/${process.env.MAILCHIMP_LIST_ID}`);
        console.log('✅ List access successful');
        console.log('List name:', listResponse.data.name);
        console.log('Member count:', listResponse.data.stats.member_count);
        
        // Get a few sample members
        console.log('\n👥 Sample members...');
        const membersResponse = await testClient.axios.get(
          `/lists/${process.env.MAILCHIMP_LIST_ID}/members`,
          { params: { count: 5 } }
        );
        
        const members = membersResponse.data.members || [];
        members.forEach((member, index) => {
          console.log(`${index + 1}. ${member.email_address} (${member.status})`);
          
          // Look for test email
          if (member.email_address === 'chris.frazier@wemakegood.org') {
            console.log('   ⭐ Found test email - safe to modify');
            console.log('   Tags:', member.tags?.map(t => t.name).join(', ') || 'None');
            console.log('   Merge fields:', JSON.stringify(member.merge_fields, null, 2));
          }
        });

      } catch (error) {
        console.log('❌ List access failed:', error.message);
        if (error.response?.status === 404) {
          console.log('💡 List not found. Check the MAILCHIMP_LIST_ID value.');
        }
      }

    } catch (error) {
      console.log('❌ Failed to list available lists:', error.message);
    }

  } catch (error) {
    console.log('❌ Diagnostic failed:', error.message);
  }
}

// Run diagnostic
diagnosticTest();