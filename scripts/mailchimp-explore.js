#!/usr/bin/env node

require('dotenv').config();
const axios = require('axios');

class MailChimpExplorer {
  constructor() {
    this.apiKey = process.env.MAILCHIMP_API_KEY;
    this.listId = process.env.MAILCHIMP_LIST_ID;
    
    if (!this.apiKey) {
      throw new Error('MAILCHIMP_API_KEY not found in environment');
    }
    
    if (!this.listId) {
      throw new Error('MAILCHIMP_LIST_ID not found in environment');
    }
    
    // Extract datacenter from API key (format: key-dc)
    const dc = this.apiKey.split('-')[1];
    if (!dc) {
      throw new Error('Invalid MailChimp API key format');
    }
    
    this.baseURL = `https://${dc}.api.mailchimp.com/3.0`;
    
    this.client = axios.create({
      baseURL: this.baseURL,
      auth: {
        username: 'anystring',
        password: this.apiKey
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async exploreAPI() {
    console.log('🔍 MailChimp API Exploration\n');
    
    try {
      // 1. Test API connection and get account info
      console.log('📡 Testing API connection...');
      const accountInfo = await this.client.get('/');
      console.log(`✅ Connected to MailChimp account: ${accountInfo.data.account_name}`);
      console.log(`   Account ID: ${accountInfo.data.account_id}`);
      console.log(`   Email: ${accountInfo.data.email}`);
      console.log('');

      // 2. Get all available lists first
      console.log('📋 Discovering available lists...');
      const allLists = await this.client.get('/lists');
      console.log(`Found ${allLists.data.lists.length} lists:`);
      allLists.data.lists.forEach(list => {
        console.log(`   ${list.id}: ${list.name} (${list.stats.member_count} members)`);
      });
      console.log('');

      // Check if target list exists
      const targetList = allLists.data.lists.find(list => list.id === this.listId);
      if (!targetList) {
        console.log(`❌ Target list ${this.listId} not found. Using first available list for exploration.`);
        if (allLists.data.lists.length > 0) {
          this.listId = allLists.data.lists[0].id;
          console.log(`📋 Using list: ${allLists.data.lists[0].name} (${this.listId})`);
        } else {
          throw new Error('No lists found in MailChimp account');
        }
      }

      // 3. Get list information
      console.log('📋 Exploring target list...');
      const listInfo = await this.client.get(`/lists/${this.listId}`);
      console.log(`✅ List: ${listInfo.data.name}`);
      console.log(`   Subscriber count: ${listInfo.data.stats.member_count}`);
      console.log(`   Created: ${listInfo.data.date_created}`);
      console.log('');

      // 3. Explore merge fields (custom fields)
      console.log('🏷️  Exploring merge fields...');
      const mergeFields = await this.client.get(`/lists/${this.listId}/merge-fields`);
      console.log(`Found ${mergeFields.data.merge_fields.length} merge fields:`);
      mergeFields.data.merge_fields.forEach(field => {
        console.log(`   ${field.tag}: ${field.name} (${field.type}${field.required ? ', required' : ''})`);
      });
      console.log('');

      // 4. Explore tags/groups
      console.log('🏷️  Exploring tags...');
      try {
        const tags = await this.client.get(`/lists/${this.listId}/tag-search`);
        if (tags.data.tags && tags.data.tags.length > 0) {
          console.log(`Found ${tags.data.tags.length} tags:`);
          tags.data.tags.slice(0, 10).forEach(tag => {
            console.log(`   ${tag.name} (${tag.member_count} members)`);
          });
          if (tags.data.tags.length > 10) {
            console.log(`   ... and ${tags.data.tags.length - 10} more`);
          }
        } else {
          console.log('   No tags found');
        }
      } catch (error) {
        console.log('   No tags found or tags not accessible');
      }
      console.log('');

      // 5. Explore segments
      console.log('📊 Exploring segments...');
      const segments = await this.client.get(`/lists/${this.listId}/segments`);
      console.log(`Found ${segments.data.segments.length} segments:`);
      segments.data.segments.forEach(segment => {
        console.log(`   ${segment.name}: ${segment.member_count} members (${segment.type})`);
      });
      console.log('');

      // 6. Sample a few members to understand structure
      console.log('👥 Sampling existing members...');
      const members = await this.client.get(`/lists/${this.listId}/members`, {
        params: { count: 3 }
      });
      
      console.log(`Found ${members.data.total_items} total members, showing first 3:`);
      members.data.members.forEach((member, index) => {
        console.log(`\n   Member ${index + 1}:`);
        console.log(`     Email: ${member.email_address}`);
        console.log(`     Status: ${member.status}`);
        console.log(`     Subscription date: ${member.timestamp_signup || 'N/A'}`);
        console.log(`     Last changed: ${member.last_changed}`);
        console.log(`     Merge fields: ${JSON.stringify(member.merge_fields, null, 6)}`);
        if (member.tags && member.tags.length > 0) {
          console.log(`     Tags: ${member.tags.map(t => t.name).join(', ')}`);
        }
      });

      return {
        accountInfo: accountInfo.data,
        listInfo: listInfo.data,
        mergeFields: mergeFields.data.merge_fields,
        sampleMembers: members.data.members
      };

    } catch (error) {
      console.error('❌ API exploration failed:', error.response?.data || error.message);
      throw error;
    }
  }

  async checkMemberExists(email) {
    try {
      // MailChimp uses MD5 hash of lowercase email as member ID
      const crypto = require('crypto');
      const memberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
      
      const member = await this.client.get(`/lists/${this.listId}/members/${memberHash}`);
      return {
        exists: true,
        member: member.data
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return { exists: false };
      }
      throw error;
    }
  }

  async suggestDonorFieldMapping() {
    console.log('\n💡 Suggested donor data mapping to MailChimp:');
    console.log('');
    
    const suggestions = [
      {
        donorField: 'first_name',
        mailchimpField: 'FNAME',
        description: 'Standard MailChimp first name field'
      },
      {
        donorField: 'last_name',
        mailchimpField: 'LNAME', 
        description: 'Standard MailChimp last name field'
      },
      {
        donorField: 'lifetime_donation_amount',
        mailchimpField: 'LIFETIME',
        description: 'Custom field for total giving amount'
      },
      {
        donorField: 'lifetime_donation_count',
        mailchimpField: 'GIFTCOUNT',
        description: 'Custom field for number of donations'
      },
      {
        donorField: 'last_donation_date',
        mailchimpField: 'LASTGIFT',
        description: 'Custom field for most recent donation date'
      },
      {
        donorField: 'first_donation_date',
        mailchimpField: 'FIRSTGIFT',
        description: 'Custom field for first donation date'
      },
      {
        donorField: 'donor_value_tier',
        mailchimpField: 'DONORLEVEL',
        description: 'Custom field for donor segmentation tier'
      },
      {
        donorField: 'engagement_status',
        mailchimpField: 'ENGAGEMENT',
        description: 'Custom field for donor engagement status'
      },
      {
        donorField: 'monthly_recurring_amount',
        mailchimpField: 'RECURRING',
        description: 'Custom field for monthly recurring donation'
      }
    ];

    suggestions.forEach(mapping => {
      console.log(`   ${mapping.donorField} → ${mapping.mailchimpField}`);
      console.log(`     ${mapping.description}`);
      console.log('');
    });

    console.log('🏷️  Suggested tags based on donor segments:');
    console.log('   - Donor Value Tiers: "Major Donor", "Regular Donor", etc.');
    console.log('   - Engagement Status: "Recent", "Active", "Lapsed", etc.');
    console.log('   - Recurring Donors: "Monthly Recurring", "Has Active Plan"');
    console.log('   - Geographic: Based on address data if available');
    console.log('');

    return suggestions;
  }
}

async function exploreMailChimp() {
  try {
    const explorer = new MailChimpExplorer();
    
    const data = await explorer.exploreAPI();
    
    // Check if our test email exists
    console.log('\n🧪 Checking test email...');
    const testResult = await explorer.checkMemberExists('chris.frazier@wemakegood.org');
    if (testResult.exists) {
      console.log('✅ Test email chris.frazier@wemakegood.org exists in list');
      console.log(`   Status: ${testResult.member.status}`);
      console.log(`   Merge fields: ${JSON.stringify(testResult.member.merge_fields, null, 2)}`);
    } else {
      console.log('ℹ️  Test email chris.frazier@wemakegood.org not found in list');
    }
    
    await explorer.suggestDonorFieldMapping();
    
    console.log('✅ MailChimp exploration complete!');
    
  } catch (error) {
    console.error('❌ Exploration failed:', error.message);
  }
}

exploreMailChimp();