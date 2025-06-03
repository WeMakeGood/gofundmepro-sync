/**
 * Find Test Email in MailChimp List
 * 
 * Look for chris.frazier@wemakegood.org in the main list
 */

// Load environment variables
require('dotenv').config();

const { MailChimpClient } = require('../src/integrations/mailchimp-client');

async function findTestEmail() {
  try {
    const listId = '06411e98fe'; // Unified Audience
    const testEmail = 'chris.frazier@wemakegood.org';
    
    console.log(`🔍 Searching for ${testEmail} in Unified Audience...`);

    const testClient = new MailChimpClient({
      apiKey: process.env.MAILCHIMP_API_KEY,
      listId: listId
    });

    // Try to get the specific member
    try {
      const member = await testClient.getMember(testEmail);
      
      if (member) {
        console.log('✅ Test email found!');
        console.log('Status:', member.status);
        console.log('Member since:', new Date(member.timestamp_opt).toLocaleDateString());
        console.log('Tags:', member.tags?.map(t => t.name).join(', ') || 'None');
        console.log('Merge fields:');
        Object.entries(member.merge_fields || {}).forEach(([key, value]) => {
          console.log(`  ${key}: ${value}`);
        });
        
        // This confirms it's safe to test with this email
        console.log('\n🎯 This email is safe for testing cleanup operations!');
        
      } else {
        console.log('❌ Test email not found in this list');
      }
      
    } catch (error) {
      if (error.statusCode === 404) {
        console.log('❌ Test email not found in this list');
      } else {
        console.log('❌ Error searching for test email:', error.message);
      }
    }

    // Also search for any @wemakegood.org emails
    console.log('\n🔍 Searching for any @wemakegood.org emails...');
    
    let found = 0;
    let offset = 0;
    const searchBatchSize = 1000;
    
    while (offset < 5000) { // Search first 5k members
      try {
        const response = await testClient.axios.get(`/lists/${listId}/members`, {
          params: {
            offset,
            count: searchBatchSize,
            fields: 'members.email_address,members.status,members.merge_fields,members.tags'
          }
        });
        
        const members = response.data.members || [];
        
        const testEmails = members.filter(m => m.email_address.includes('@wemakegood.org'));
        testEmails.forEach(member => {
          found++;
          console.log(`${found}. ${member.email_address} (${member.status})`);
          if (member.tags?.length > 0) {
            console.log(`   Tags: ${member.tags.map(t => t.name).join(', ')}`);
          }
        });
        
        if (members.length < searchBatchSize) {
          break; // Last page
        }
        
        offset += searchBatchSize;
        
      } catch (error) {
        console.log('Search error:', error.message);
        break;
      }
    }
    
    console.log(`\nFound ${found} @wemakegood.org email(s) in the first 5,000 members.`);

  } catch (error) {
    console.log('❌ Search failed:', error.message);
  }
}

findTestEmail();