/**
 * MailChimp List Explorer
 * 
 * Explore both available lists to determine which one to clean up
 */

// Load environment variables
require('dotenv').config();

const { MailChimpClient } = require('../src/integrations/mailchimp-client');

async function exploreLists() {
  try {
    console.log('🔍 MailChimp List Explorer\n');

    const testClient = new MailChimpClient({
      apiKey: process.env.MAILCHIMP_API_KEY,
      listId: 'temp' // We'll override this
    });

    // Get both lists
    const listsResponse = await testClient.axios.get('/lists');
    const lists = listsResponse.data.lists || [];

    for (const list of lists) {
      console.log(`📋 Analyzing: ${list.name} (ID: ${list.id})`);
      console.log(`   Members: ${list.stats.member_count.toLocaleString()}`);
      console.log(`   Created: ${new Date(list.date_created).toLocaleDateString()}`);
      console.log(`   Subscribed: ${list.stats.member_count_since_send}`);
      console.log(`   Unsubscribed: ${list.stats.unsubscribe_count}`);
      
      // Get sample members to look for patterns
      try {
        const membersResponse = await testClient.axios.get(
          `/lists/${list.id}/members`,
          { 
            params: { 
              count: 10,
              fields: 'members.email_address,members.status,members.merge_fields,members.tags,members.timestamp_opt'
            }
          }
        );
        
        const members = membersResponse.data.members || [];
        console.log(`\n   📧 Sample emails:`);
        
        let hasClassyTags = false;
        let hasTestEmails = false;
        let hasClassyMergeFields = false;
        
        members.slice(0, 5).forEach((member, index) => {
          console.log(`   ${index + 1}. ${member.email_address} (${member.status})`);
          
          // Check for test emails
          if (member.email_address.includes('@wemakegood.org')) {
            hasTestEmails = true;
            console.log(`      ⭐ Test email found`);
            
            if (member.email_address === 'chris.frazier@wemakegood.org') {
              console.log(`      🎯 Target test email for safe testing`);
              console.log(`      Tags: ${member.tags?.map(t => t.name).join(', ') || 'None'}`);
              console.log(`      Merge fields:`, Object.keys(member.merge_fields || {}).join(', ') || 'None');
            }
          }
          
          // Check for Classy tags
          const tags = member.tags?.map(t => t.name) || [];
          if (tags.some(tag => tag.includes('Classy'))) {
            hasClassyTags = true;
          }
          
          // Check for Classy merge fields
          const mergeFields = Object.keys(member.merge_fields || {});
          if (mergeFields.includes('TOTALAMT') || mergeFields.includes('DONCNT')) {
            hasClassyMergeFields = true;
          }
        });
        
        console.log(`\n   🏷️  Has Classy tags: ${hasClassyTags ? '✅' : '❌'}`);
        console.log(`   📊 Has Classy merge fields: ${hasClassyMergeFields ? '✅' : '❌'}`);
        console.log(`   🧪 Has test emails: ${hasTestEmails ? '✅' : '❌'}`);
        
        // Check merge fields configuration
        const mergeFieldsResponse = await testClient.axios.get(`/lists/${list.id}/merge-fields`);
        const mergeFields = mergeFieldsResponse.data.merge_fields || [];
        console.log(`   📝 Merge fields: ${mergeFields.map(f => f.tag).join(', ')}`);
        
      } catch (error) {
        console.log(`   ❌ Failed to analyze members: ${error.message}`);
      }
      
      console.log('   ' + '─'.repeat(50));
    }

    // Recommendation
    console.log('\n🎯 RECOMMENDATION:');
    const largeList = lists.find(l => l.stats.member_count > 1000);
    if (largeList) {
      console.log(`Focus cleanup on: ${largeList.name} (ID: ${largeList.id})`);
      console.log(`This appears to be the main production list with ${largeList.stats.member_count.toLocaleString()} members.`);
      console.log(`\nUpdate your .env file:`);
      console.log(`MAILCHIMP_LIST_ID=${largeList.id}`);
    }

  } catch (error) {
    console.log('❌ Exploration failed:', error.message);
  }
}

exploreLists();