/**
 * MailChimp Cleanup Analysis Script
 * 
 * Analyzes existing MailChimp list data to develop cleanup strategy
 * This script will be removed after cleanup is complete
 */

const { MailChimpClient } = require('../src/integrations/mailchimp-client');
const { getKnex } = require('../src/config/database');
const { createLogger } = require('../src/utils/logger');

const logger = createLogger('mailchimp-cleanup');

class MailChimpCleanupAnalysis {
  constructor() {
    this.mailchimpClient = null;
    this.db = null;
    this.analysis = {
      totalMembers: 0,
      classyMatches: 0,
      testEmails: 0,
      duplicates: 0,
      invalidEmails: 0,
      outdatedTags: 0,
      missingMergeFields: 0,
      recommendations: []
    };
  }

  async initialize() {
    // Initialize MailChimp client
    if (!process.env.MAILCHIMP_API_KEY || !process.env.MAILCHIMP_LIST_ID) {
      throw new Error('MailChimp configuration missing. Set MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID');
    }

    this.mailchimpClient = new MailChimpClient({
      apiKey: process.env.MAILCHIMP_API_KEY,
      listId: process.env.MAILCHIMP_LIST_ID
    });

    // Initialize database
    try {
      const { database } = require('../src/config/database');
      await database.initialize();
      this.db = getKnex();
      logger.info('Database connected for Classy data comparison');
    } catch (error) {
      logger.warn('Database connection failed - will skip Classy data comparison', {
        error: error.message
      });
      this.db = null;
    }

    logger.info('Cleanup analysis initialized');
  }

  /**
   * Analyze existing MailChimp list members
   */
  async analyzeExistingMembers() {
    logger.info('Starting analysis of existing MailChimp members');

    try {
      // Get list info
      const listInfo = await this.mailchimpClient.getListInfo();
      logger.info('MailChimp list info', {
        listName: listInfo.list.name,
        totalMembers: listInfo.list.stats.member_count,
        mergeFields: listInfo.mergeFields.length
      });

      this.analysis.totalMembers = listInfo.list.stats.member_count;

      // Analyze merge fields
      this.analyzeMergeFields(listInfo.mergeFields);

      // Get all members (paginated)
      const members = await this.getAllMembers();
      logger.info(`Retrieved ${members.length} members for analysis`);

      // Analyze each member
      for (const member of members) {
        await this.analyzeMember(member);
      }

      // Generate recommendations
      this.generateRecommendations();

      return this.analysis;

    } catch (error) {
      logger.error('Failed to analyze MailChimp members', { error: error.message });
      throw error;
    }
  }

  /**
   * Get all members from MailChimp list
   */
  async getAllMembers() {
    const members = [];
    let offset = 0;
    const count = 1000; // MailChimp limit

    while (true) {
      try {
        const response = await this.mailchimpClient.axios.get(
          `/lists/${this.mailchimpClient.listId}/members`,
          {
            params: {
              offset,
              count,
              fields: 'members.email_address,members.status,members.merge_fields,members.tags,members.timestamp_opt'
            }
          }
        );

        const batch = response.data.members || [];
        members.push(...batch);

        logger.info(`Retrieved batch: ${batch.length} members (total: ${members.length})`);

        if (batch.length < count) {
          break; // Last page
        }

        offset += count;

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        logger.error('Failed to fetch members batch', { offset, error: error.message });
        break;
      }
    }

    return members;
  }

  /**
   * Analyze individual member
   */
  async analyzeMember(member) {
    const email = member.email_address;

    // Check if test email
    if (email.includes('@wemakegood.org')) {
      this.analysis.testEmails++;
      
      if (email === 'chris.frazier@wemakegood.org') {
        logger.info('Found test email (safe to modify)', {
          email,
          status: member.status,
          mergeFields: member.merge_fields,
          tags: member.tags?.map(t => t.name) || []
        });
      }
    }

    // Check for invalid email patterns
    if (!this.isValidEmail(email)) {
      this.analysis.invalidEmails++;
    }

    // Check if exists in Classy database
    const classySupporter = await this.findClassySupporter(email);
    if (classySupporter) {
      this.analysis.classyMatches++;
      
      // Compare data quality
      await this.compareWithClassyData(member, classySupporter);
    }

    // Analyze tags
    this.analyzeTags(member.tags || []);

    // Analyze merge fields
    this.analyzeMemberMergeFields(member.merge_fields || {});
  }

  /**
   * Find corresponding Classy supporter
   */
  async findClassySupporter(email) {
    if (!this.db) {
      return null; // Database not available
    }
    
    try {
      return await this.db('supporters')
        .where('email_address', email)
        .first();
    } catch (error) {
      logger.debug('Failed to query Classy supporter', { email, error: error.message });
      return null;
    }
  }

  /**
   * Compare MailChimp member with Classy data
   */
  async compareWithClassyData(member, supporter) {
    const mergeFields = member.merge_fields || {};
    
    // Check data consistency
    const issues = [];

    // Name comparison
    if (mergeFields.FNAME !== supporter.first_name) {
      issues.push(`Name mismatch: MC="${mergeFields.FNAME}" vs Classy="${supporter.first_name}"`);
    }

    // Lifetime amount comparison
    const mcAmount = parseFloat(mergeFields.TOTALAMT || 0);
    const classyAmount = parseFloat(supporter.lifetime_donation_amount || 0);
    if (Math.abs(mcAmount - classyAmount) > 0.01) {
      issues.push(`Amount mismatch: MC=$${mcAmount} vs Classy=$${classyAmount}`);
    }

    // Donation count comparison
    const mcCount = parseInt(mergeFields.DONCNT || 0);
    const classyCount = parseInt(supporter.lifetime_donation_count || 0);
    if (mcCount !== classyCount) {
      issues.push(`Count mismatch: MC=${mcCount} vs Classy=${classyCount}`);
    }

    if (issues.length > 0) {
      logger.debug('Data inconsistency found', {
        email: member.email_address,
        issues
      });
    }
  }

  /**
   * Analyze merge fields configuration
   */
  analyzeMergeFields(mergeFields) {
    const expectedFields = ['FNAME', 'LNAME', 'TOTALAMT', 'DONCNT', 'RECAMT', 'ACTIVESUB'];
    const existingFields = mergeFields.map(f => f.tag);

    const missingFields = expectedFields.filter(field => !existingFields.includes(field));
    const extraFields = existingFields.filter(field => !expectedFields.includes(field) && !['EMAIL'].includes(field));

    logger.info('Merge fields analysis', {
      existing: existingFields,
      missing: missingFields,
      extra: extraFields
    });

    this.analysis.missingMergeFields = missingFields.length;
  }

  /**
   * Analyze member's merge fields
   */
  analyzeMemberMergeFields(mergeFields) {
    // Check for empty or invalid values
    const issues = [];

    if (!mergeFields.FNAME && !mergeFields.LNAME) {
      issues.push('Missing name fields');
    }

    if (mergeFields.TOTALAMT && isNaN(parseFloat(mergeFields.TOTALAMT))) {
      issues.push('Invalid total amount');
    }

    if (mergeFields.DONCNT && isNaN(parseInt(mergeFields.DONCNT))) {
      issues.push('Invalid donation count');
    }

    // Log issues for debugging
    if (issues.length > 0) {
      logger.debug('Merge field issues', { mergeFields, issues });
    }
  }

  /**
   * Analyze tags
   */
  analyzeTags(tags) {
    const tagNames = tags.map(t => t.name);
    
    // Check for outdated or inconsistent tags
    const outdatedPatterns = [
      /^(?!Classy-)/,  // Tags not starting with Classy-
      /test/i,         // Test tags
      /old/i,          // Old tags
      /temp/i          // Temporary tags
    ];

    const outdatedTags = tagNames.filter(tag => 
      outdatedPatterns.some(pattern => pattern.test(tag))
    );

    if (outdatedTags.length > 0) {
      this.analysis.outdatedTags += outdatedTags.length;
    }

    // Check for duplicate semantic meaning
    const duplicatePatterns = [
      { pattern: /donor/i, matches: tagNames.filter(t => /donor/i.test(t)) },
      { pattern: /recurring/i, matches: tagNames.filter(t => /recurring/i.test(t)) },
      { pattern: /\$\d+/i, matches: tagNames.filter(t => /\$\d+/i.test(t)) }
    ];

    duplicatePatterns.forEach(({ pattern, matches }) => {
      if (matches.length > 1) {
        this.analysis.duplicates += matches.length - 1;
      }
    });
  }

  /**
   * Validate email format
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Generate cleanup recommendations
   */
  generateRecommendations() {
    const { recommendations } = this.analysis;

    // High priority recommendations
    if (this.analysis.invalidEmails > 0) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Remove invalid email addresses',
        count: this.analysis.invalidEmails,
        description: 'Clean up malformed email addresses that cannot receive emails'
      });
    }

    if (this.analysis.outdatedTags > 0) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Remove outdated tags',
        count: this.analysis.outdatedTags,
        description: 'Remove tags that don\'t follow Classy- prefix convention'
      });
    }

    // Medium priority recommendations
    if (this.analysis.duplicates > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Consolidate duplicate tags',
        count: this.analysis.duplicates,
        description: 'Merge tags with similar semantic meaning'
      });
    }

    if (this.analysis.missingMergeFields > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Create missing merge fields',
        count: this.analysis.missingMergeFields,
        description: 'Add standard Classy merge fields for data consistency'
      });
    }

    // Low priority recommendations
    if (this.analysis.testEmails > 0) {
      recommendations.push({
        priority: 'LOW',
        action: 'Review test emails',
        count: this.analysis.testEmails,
        description: 'Decide whether to keep or remove @wemakegood.org test addresses'
      });
    }

    // Data sync recommendations
    const dataInconsistencyRate = this.analysis.classyMatches > 0 
      ? ((this.analysis.totalMembers - this.analysis.classyMatches) / this.analysis.totalMembers * 100)
      : 0;

    if (dataInconsistencyRate > 10) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Full data resync required',
        description: `${dataInconsistencyRate.toFixed(1)}% of members don't match Classy data`
      });
    }
  }

  /**
   * Generate summary report
   */
  generateSummaryReport() {
    logger.info('='.repeat(60));
    logger.info('MAILCHIMP CLEANUP ANALYSIS SUMMARY');
    logger.info('='.repeat(60));
    
    logger.info('Current State:', {
      totalMembers: this.analysis.totalMembers,
      classyMatches: this.analysis.classyMatches,
      matchRate: this.analysis.totalMembers > 0 
        ? `${(this.analysis.classyMatches / this.analysis.totalMembers * 100).toFixed(1)}%`
        : '0%'
    });

    logger.info('Issues Found:', {
      testEmails: this.analysis.testEmails,
      invalidEmails: this.analysis.invalidEmails,
      outdatedTags: this.analysis.outdatedTags,
      duplicateTags: this.analysis.duplicates,
      missingMergeFields: this.analysis.missingMergeFields
    });

    logger.info('Cleanup Recommendations:');
    this.analysis.recommendations.forEach((rec, index) => {
      logger.info(`${index + 1}. [${rec.priority}] ${rec.action}`, {
        count: rec.count || 'N/A',
        description: rec.description
      });
    });

    return this.analysis;
  }
}

// Main execution
async function main() {
  try {
    const analyzer = new MailChimpCleanupAnalysis();
    await analyzer.initialize();
    
    logger.info('Starting MailChimp cleanup analysis...');
    await analyzer.analyzeExistingMembers();
    
    const summary = analyzer.generateSummaryReport();
    
    logger.info('Analysis complete. Review recommendations above.');
    
    // Save summary to file for review
    const fs = require('fs');
    fs.writeFileSync(
      './mailchimp-cleanup-analysis.json',
      JSON.stringify(summary, null, 2)
    );
    
    logger.info('Detailed analysis saved to mailchimp-cleanup-analysis.json');

  } catch (error) {
    logger.error('Cleanup analysis failed', { error: error.message });
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { MailChimpCleanupAnalysis };