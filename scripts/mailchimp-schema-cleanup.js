/**
 * MailChimp Schema Cleanup Script
 * 
 * Identifies and standardizes legacy Classy data fields in MailChimp that may not
 * match the current data schema. This includes merge fields, tags, and member data
 * from previous sync implementations.
 * 
 * CONSERVATIVE APPROACH:
 * - Analyzes existing merge fields and tags
 * - Identifies inconsistencies with current schema
 * - Creates standardization plan without breaking existing data
 * - Preserves member preferences and history
 */

const { MailChimpClient } = require('../src/integrations/mailchimp-client');
const { database } = require('../src/config/database');
const { createLogger } = require('../src/utils/logger');
const fs = require('fs');
const path = require('path');

const logger = createLogger('mailchimp-schema-cleanup');

class MailChimpSchemaCleanup {
  constructor() {
    this.mailchimpClient = null;
    this.currentSchema = this.getCurrentClassySchema();
    this.analysis = {
      mergeFields: {
        current: [],
        legacy: [],
        missing: [],
        inconsistent: []
      },
      tags: {
        current: [],
        legacy: [],
        standardized: [],
        duplicates: []
      },
      recommendations: []
    };
  }

  /**
   * Get the current Classy data schema for MailChimp
   */
  getCurrentClassySchema() {
    return {
      mergeFields: {
        FNAME: { name: 'First Name', type: 'text', description: 'Supporter first name' },
        LNAME: { name: 'Last Name', type: 'text', description: 'Supporter last name' },
        TOTALAMT: { name: 'Total Lifetime Amount', type: 'number', description: 'Total lifetime donations' },
        DONCNT: { name: 'Donation Count', type: 'number', description: 'Number of donations made' },
        RECAMT: { name: 'Monthly Recurring Amount', type: 'number', description: 'Monthly recurring donation amount' },
        ACTIVESUB: { name: 'Active Subscription', type: 'text', description: 'Has active recurring subscription (Yes/No)' }
      },
      tagPrefix: 'Classy-',
      standardTags: [
        // Value Tiers
        'Transformational', 'Principal Donor', 'Major Donor', 'Regular Donor', 'Small Donor', 'First-Time',
        // Frequency
        'Champion Donor', 'Loyal Donor', 'Repeat Donor', 'One-Time Donor',
        // Engagement
        'Recent Donor', 'Active Donor', 'Warm Donor', 'Cooling Donor', 'Lapsed Donor', 'Dormant Donor',
        // Special
        'Monthly Recurring', '$1K+ Lifetime', '$5K+ Lifetime', '$100+ Monthly'
      ]
    };
  }

  /**
   * Run complete schema analysis and cleanup
   */
  async runCleanup() {
    try {
      await database.initialize();
      
      console.log('🔧 Starting MailChimp schema cleanup analysis...\n');

      // Initialize MailChimp client
      await this.initializeMailChimpClient();
      
      // Step 1: Analyze current merge fields
      await this.analyzeMergeFields();
      
      // Step 2: Analyze current tags
      await this.analyzeTags();
      
      // Step 3: Generate cleanup recommendations
      await this.generateRecommendations();
      
      // Step 4: Create cleanup plan
      await this.createCleanupPlan();
      
      console.log('\n✅ Schema cleanup analysis completed');
      this.printSummary();
      
      await database.close();
      
    } catch (error) {
      logger.error('Schema cleanup analysis failed', { error: error.message });
      console.error('❌ Analysis failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Initialize MailChimp client
   */
  async initializeMailChimpClient() {
    if (!process.env.MAILCHIMP_API_KEY || !process.env.MAILCHIMP_LIST_ID) {
      throw new Error('MailChimp configuration missing. Set MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID.');
    }

    this.mailchimpClient = new MailChimpClient({
      apiKey: process.env.MAILCHIMP_API_KEY,
      listId: process.env.MAILCHIMP_LIST_ID
    });

    const health = await this.mailchimpClient.healthCheck();
    if (health.status !== 'healthy') {
      throw new Error(`MailChimp API health check failed: ${health.error}`);
    }

    console.log(`🔗 Connected to MailChimp list: ${health.listName}`);
    console.log(`📊 Current members: ${health.memberCount.toLocaleString()}\n`);
  }

  /**
   * Analyze existing merge fields in MailChimp
   */
  async analyzeMergeFields() {
    console.log('🔍 Analyzing MailChimp merge fields...');
    
    try {
      // Get current merge fields from MailChimp
      const response = await this.mailchimpClient.axios.get(`/lists/${process.env.MAILCHIMP_LIST_ID}/merge-fields`);
      const existingFields = response.data.merge_fields || [];
      
      this.analysis.mergeFields.current = existingFields;
      
      console.log(`   Found ${existingFields.length} existing merge fields`);
      
      // Analyze each field
      existingFields.forEach(field => {
        const tag = field.tag;
        const expectedField = this.currentSchema.mergeFields[tag];
        
        if (expectedField) {
          // Field exists in current schema
          if (field.name !== expectedField.name || field.type !== expectedField.type) {
            this.analysis.mergeFields.inconsistent.push({
              tag,
              current: { name: field.name, type: field.type },
              expected: { name: expectedField.name, type: expectedField.type },
              field
            });
          }
        } else if (tag.startsWith('CLASSY') || tag.includes('DONOR') || tag.includes('TOTAL')) {
          // Looks like legacy Classy field
          this.analysis.mergeFields.legacy.push(field);
        }
      });
      
      // Check for missing fields
      Object.entries(this.currentSchema.mergeFields).forEach(([tag, schema]) => {
        const exists = existingFields.find(f => f.tag === tag);
        if (!exists) {
          this.analysis.mergeFields.missing.push({ tag, schema });
        }
      });
      
      console.log(`   ✅ Standard fields: ${existingFields.length - this.analysis.mergeFields.legacy.length - this.analysis.mergeFields.inconsistent.length}`);
      console.log(`   ⚠️  Legacy fields: ${this.analysis.mergeFields.legacy.length}`);
      console.log(`   🔄 Inconsistent fields: ${this.analysis.mergeFields.inconsistent.length}`);
      console.log(`   ❌ Missing fields: ${this.analysis.mergeFields.missing.length}\n`);
      
    } catch (error) {
      logger.error('Failed to analyze merge fields', { error: error.message });
      throw error;
    }
  }

  /**
   * Analyze existing tags in MailChimp
   */
  async analyzeTags() {
    console.log('🏷️  Analyzing MailChimp tags...');
    
    try {
      // Get sample of members to analyze tags
      const response = await this.mailchimpClient.axios.get(`/lists/${process.env.MAILCHIMP_LIST_ID}/members`, {
        params: {
          count: 500,
          fields: 'members.email_address,members.tags'
        }
      });
      
      const members = response.data.members || [];
      const allTags = new Set();
      const tagFrequency = {};
      
      // Collect all tags
      members.forEach(member => {
        if (member.tags && member.tags.length > 0) {
          member.tags.forEach(tagObj => {
            const tagName = tagObj.name;
            allTags.add(tagName);
            tagFrequency[tagName] = (tagFrequency[tagName] || 0) + 1;
          });
        }
      });
      
      this.analysis.tags.current = Array.from(allTags);
      
      console.log(`   Found ${allTags.size} unique tags across ${members.length} members`);
      
      // Categorize tags
      allTags.forEach(tag => {
        const cleanTag = tag.replace(this.currentSchema.tagPrefix, '');
        
        if (tag.startsWith(this.currentSchema.tagPrefix)) {
          if (this.currentSchema.standardTags.includes(cleanTag)) {
            this.analysis.tags.standardized.push({ tag, frequency: tagFrequency[tag] });
          } else {
            this.analysis.tags.legacy.push({ tag, frequency: tagFrequency[tag] });
          }
        }
      });
      
      // Check for duplicates or similar tags
      const standardizedMap = {};
      this.currentSchema.standardTags.forEach(standardTag => {
        const variations = Array.from(allTags).filter(tag => {
          const cleanTag = tag.replace(/^Classy-?/i, '').toLowerCase();
          return cleanTag.includes(standardTag.toLowerCase()) || 
                 standardTag.toLowerCase().includes(cleanTag);
        });
        
        if (variations.length > 1) {
          standardizedMap[standardTag] = variations;
        }
      });
      
      this.analysis.tags.duplicates = Object.entries(standardizedMap).map(([standard, variations]) => ({
        standardTag: standard,
        variations,
        frequencies: variations.map(v => ({ tag: v, frequency: tagFrequency[v] || 0 }))
      }));
      
      console.log(`   ✅ Standardized tags: ${this.analysis.tags.standardized.length}`);
      console.log(`   ⚠️  Legacy tags: ${this.analysis.tags.legacy.length}`);
      console.log(`   🔄 Potential duplicates: ${this.analysis.tags.duplicates.length}\n`);
      
    } catch (error) {
      logger.error('Failed to analyze tags', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate cleanup recommendations
   */
  async generateRecommendations() {
    const recommendations = [];
    
    // Merge field recommendations
    if (this.analysis.mergeFields.missing.length > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'merge_fields',
        action: 'Add missing merge fields',
        description: `Add ${this.analysis.mergeFields.missing.length} missing standard merge fields`,
        fields: this.analysis.mergeFields.missing,
        impact: 'Enables full Classy data sync capabilities'
      });
    }
    
    if (this.analysis.mergeFields.inconsistent.length > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'merge_fields',
        action: 'Update inconsistent merge fields',
        description: `Update ${this.analysis.mergeFields.inconsistent.length} fields with incorrect names or types`,
        fields: this.analysis.mergeFields.inconsistent,
        impact: 'Ensures consistent data types and naming'
      });
    }
    
    if (this.analysis.mergeFields.legacy.length > 0) {
      recommendations.push({
        priority: 'LOW',
        category: 'merge_fields',
        action: 'Consider removing legacy merge fields',
        description: `${this.analysis.mergeFields.legacy.length} legacy fields found - evaluate if still needed`,
        fields: this.analysis.mergeFields.legacy,
        impact: 'Reduces field clutter, but may affect existing automations'
      });
    }
    
    // Tag recommendations
    if (this.analysis.tags.duplicates.length > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'tags',
        action: 'Consolidate duplicate tags',
        description: `Merge ${this.analysis.tags.duplicates.length} sets of similar tags`,
        details: this.analysis.tags.duplicates,
        impact: 'Improves segmentation consistency'
      });
    }
    
    if (this.analysis.tags.legacy.length > 0) {
      recommendations.push({
        priority: 'LOW',
        category: 'tags',
        action: 'Review legacy tags',
        description: `${this.analysis.tags.legacy.length} non-standard Classy tags found`,
        tags: this.analysis.tags.legacy,
        impact: 'May indicate outdated segmentation logic'
      });
    }
    
    // General recommendations
    recommendations.push({
      priority: 'INFO',
      category: 'general',
      action: 'Conservative cleanup approach',
      description: 'Preserve existing data while standardizing for future syncs',
      impact: 'Minimizes disruption to existing workflows'
    });
    
    this.analysis.recommendations = recommendations;
  }

  /**
   * Create detailed cleanup plan
   */
  async createCleanupPlan() {
    const timestamp = new Date().toISOString().split('T')[0];
    const planPath = path.join(__dirname, `../data/mailchimp-schema-cleanup-plan-${timestamp}.json`);
    
    const plan = {
      analysisDate: new Date().toISOString(),
      listInfo: {
        listId: process.env.MAILCHIMP_LIST_ID,
        listName: 'Unified Audience' // This should be dynamic
      },
      currentSchema: this.currentSchema,
      analysis: this.analysis,
      executionPlan: {
        phase1: {
          name: 'Add Missing Merge Fields',
          actions: this.analysis.mergeFields.missing.map(field => ({
            action: 'CREATE',
            type: 'merge_field',
            tag: field.tag,
            name: field.schema.name,
            fieldType: field.schema.type,
            description: field.schema.description
          }))
        },
        phase2: {
          name: 'Update Inconsistent Fields',
          actions: this.analysis.mergeFields.inconsistent.map(field => ({
            action: 'UPDATE',
            type: 'merge_field',
            current: field.current,
            target: field.expected,
            mergeFieldId: field.field.merge_id
          }))
        },
        phase3: {
          name: 'Standardize Tags',
          actions: this.analysis.tags.duplicates.map(duplicate => ({
            action: 'CONSOLIDATE',
            type: 'tags',
            standardTag: `${this.currentSchema.tagPrefix}${duplicate.standardTag}`,
            variations: duplicate.variations,
            strategy: 'Migrate all variations to standard tag'
          }))
        }
      }
    };
    
    // Ensure data directory exists
    const dataDir = path.dirname(planPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
    console.log(`📋 Schema cleanup plan saved: ${planPath}`);
  }

  /**
   * Print analysis summary
   */
  printSummary() {
    console.log('\n' + '='.repeat(70));
    console.log('🔧 MAILCHIMP SCHEMA CLEANUP ANALYSIS SUMMARY');
    console.log('='.repeat(70));
    
    console.log('📋 MERGE FIELDS ANALYSIS:');
    console.log(`   Current fields: ${this.analysis.mergeFields.current.length}`);
    console.log(`   Missing standard fields: ${this.analysis.mergeFields.missing.length}`);
    console.log(`   Inconsistent fields: ${this.analysis.mergeFields.inconsistent.length}`);
    console.log(`   Legacy fields: ${this.analysis.mergeFields.legacy.length}`);
    
    console.log('\n🏷️  TAGS ANALYSIS:');
    console.log(`   Total unique tags: ${this.analysis.tags.current.length}`);
    console.log(`   Standardized tags: ${this.analysis.tags.standardized.length}`);
    console.log(`   Legacy tags: ${this.analysis.tags.legacy.length}`);
    console.log(`   Duplicate sets: ${this.analysis.tags.duplicates.length}`);
    
    console.log('\n📊 RECOMMENDATIONS:');
    this.analysis.recommendations.forEach((rec, index) => {
      const priority = rec.priority === 'MEDIUM' ? '🟡' : rec.priority === 'LOW' ? '🔵' : 'ℹ️';
      console.log(`   ${priority} ${rec.action}: ${rec.description}`);
    });
    
    console.log('\n💡 NEXT STEPS:');
    console.log('1. Review schema cleanup plan in data/ directory');
    console.log('2. Execute merge field updates (non-destructive)');
    console.log('3. Consolidate duplicate tags gradually');
    console.log('4. Test with small member subset before bulk operations');
    console.log('5. Update Classy sync process to use standardized schema');
    console.log('='.repeat(70));
  }
}

/**
 * CLI interface
 */
async function main() {
  const cleanup = new MailChimpSchemaCleanup();
  await cleanup.runCleanup();
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Schema cleanup failed:', error.message);
    process.exit(1);
  });
}

module.exports = { MailChimpSchemaCleanup };