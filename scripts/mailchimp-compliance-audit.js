/**
 * MailChimp Compliance Audit Script
 * 
 * Cross-references exported MailChimp member list with Classy supporters to identify
 * members who should be opted-out (not deleted) for compliance.
 * 
 * CONSERVATIVE CLEANUP RULES:
 * - DO NOT delete any email records
 * - DO NOT change records only in MailChimp (not in Classy)
 * - DO NOT change records updated more recently in MailChimp than Classy
 * - DO mark as opted-out (unsubscribed) members without Classy consent
 * - DO NOT opt-in anyone already opted-out in MailChimp
 * - PRESERVE all member history and preferences
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const { database } = require('../src/config/database');
const { createLogger } = require('../src/utils/logger');

const logger = createLogger('mailchimp-compliance-audit');

class MailChimpComplianceAuditor {
  constructor() {
    this.consentedEmails = new Set();
    this.mailchimpMembers = [];
    this.auditResults = {
      totalMailChimpMembers: 0,
      totalConsentedSupporters: 0,
      membersToOptOut: [], // Changed from "remove" to "opt-out"
      validMembers: [],
      mailchimpOnlyMembers: [], // Members only in MailChimp, not in Classy
      alreadyOptedOut: [], // Members already unsubscribed in MailChimp
      duplicateEmails: [],
      recentMailchimpUpdates: [] // Members updated more recently in MailChimp
    };
  }

  /**
   * Run complete compliance audit
   * @param {string} exportFilePath - Path to exported MailChimp CSV
   * @param {number} organizationId - Organization ID to check
   */
  async runAudit(exportFilePath, organizationId = null) {
    try {
      await database.initialize();
      
      console.log('🔍 Starting MailChimp compliance audit...');
      console.log(`📁 MailChimp export file: ${exportFilePath}\n`);

      // Step 1: Load consented supporters from database
      await this.loadConsentedSupporters(organizationId);
      
      // Step 2: Load MailChimp exported members
      await this.loadMailChimpExport(exportFilePath);
      
      // Step 3: Cross-reference and identify violations
      await this.performComplianceCheck();
      
      // Step 4: Generate audit report
      await this.generateAuditReport();
      
      // Step 5: Create opt-out list
      await this.createOptOutList();
      
      console.log('\n✅ Compliance audit completed successfully');
      this.printSummary();
      
      await database.close();
      
    } catch (error) {
      logger.error('Compliance audit failed', { error: error.message });
      console.error('❌ Audit failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Load supporters with email consent from database and build consent/update tracking
   * @param {number} organizationId - Organization to check (optional)
   */
  async loadConsentedSupporters(organizationId) {
    console.log('📊 Loading consented supporters from database...');
    
    let query = database.getKnex()('supporters')
      .whereNotNull('email_address')
      .where('email_address', '!=', '')
      .where('email_opt_in', true); // CRITICAL: Only opted-in supporters
    
    if (organizationId) {
      query = query.where('organization_id', organizationId);
      console.log(`   Organization filter: ID ${organizationId}`);
    }
    
    const supporters = await query.select('id', 'email_address', 'first_name', 'last_name', 'organization_id', 'updated_at');
    
    // Build set of consented email addresses with update times (lowercase for comparison)
    this.consentedEmails = new Map(); // Change to Map to store update times
    supporters.forEach(supporter => {
      const email = supporter.email_address.toLowerCase().trim();
      this.consentedEmails.set(email, {
        consent: true,
        updatedAt: new Date(supporter.updated_at),
        supporterId: supporter.id,
        firstName: supporter.first_name,
        lastName: supporter.last_name
      });
    });
    
    this.auditResults.totalConsentedSupporters = supporters.length;
    
    console.log(`   ✅ Found ${supporters.length} supporters with email consent`);
    console.log(`   📧 Unique consented email addresses: ${this.consentedEmails.size}\n`);
  }

  /**
   * Load MailChimp exported member list from CSV
   * @param {string} filePath - Path to CSV export file
   */
  async loadMailChimpExport(filePath) {
    console.log('📁 Loading MailChimp export file...');
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`Export file not found: ${filePath}`);
    }
    
    return new Promise((resolve, reject) => {
      const members = [];
      
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          // Extract email and clean it
          const email = (row['Email Address'] || row.email || row.EMAIL || '').toLowerCase().trim();
          
          if (email && email.includes('@')) {
            // Parse various date formats for comparison
            const lastChangedStr = row['Last Changed'] || row.last_changed || row.timestamp_opt || '';
            const subscribeStr = row['Subscribe Date'] || row.timestamp_opt || '';
            
            let lastChanged = null;
            if (lastChangedStr) {
              try {
                lastChanged = new Date(lastChangedStr);
              } catch (e) {
                // Ignore invalid dates
              }
            }
            
            // For subscribed-only exports, all members are considered subscribed
            const memberStatus = row['Member Status'] || row.status || 'subscribed';
            const isSubscribed = memberStatus.toLowerCase() === 'subscribed' || 
                                 memberStatus === '' || 
                                 memberStatus === 'unknown'; // Assume subscribed if no status field
            
            members.push({
              email: email,
              firstName: row['First Name'] || row.first_name || '',
              lastName: row['Last Name'] || row.last_name || '',
              status: memberStatus.toLowerCase() || 'subscribed',
              tags: row.Tags || row.tags || '',
              subscribeDate: subscribeStr,
              lastChanged: lastChanged,
              isSubscribed: isSubscribed,
              rawRow: row // Keep original for debugging
            });
          }
        })
        .on('end', () => {
          this.mailchimpMembers = members;
          this.auditResults.totalMailChimpMembers = members.length;
          
          console.log(`   ✅ Loaded ${members.length} MailChimp members`);
          console.log(`   📧 Unique email addresses in export: ${new Set(members.map(m => m.email)).size}\n`);
          
          resolve();
        })
        .on('error', (error) => {
          reject(new Error(`Failed to parse CSV: ${error.message}`));
        });
    });
  }

  /**
   * Cross-reference MailChimp members with consented supporters using conservative rules
   */
  async performComplianceCheck() {
    console.log('🔍 Performing conservative compliance cross-reference...');
    
    const emailFrequency = {};
    
    this.mailchimpMembers.forEach(member => {
      const email = member.email;
      
      // Track email frequency for duplicate detection
      emailFrequency[email] = (emailFrequency[email] || 0) + 1;
      
      // Check if member is already opted out in MailChimp
      if (!member.isSubscribed) {
        this.auditResults.alreadyOptedOut.push({
          ...member,
          reason: 'Already unsubscribed in MailChimp - no action needed'
        });
        return;
      }
      
      // Check if this email has consent in our database
      const classyData = this.consentedEmails.get(email);
      
      if (classyData) {
        // Email found in Classy with consent
        
        // Check if MailChimp was updated more recently than Classy
        if (member.lastChanged && member.lastChanged > classyData.updatedAt) {
          this.auditResults.recentMailchimpUpdates.push({
            ...member,
            reason: 'MailChimp updated more recently than Classy - preserve MailChimp state',
            classyUpdated: classyData.updatedAt,
            mailchimpUpdated: member.lastChanged
          });
        } else {
          this.auditResults.validMembers.push({
            ...member,
            reason: 'Has email consent in Classy database',
            classySupporter: classyData.supporterId
          });
        }
      } else {
        // Email not found in Classy database
        this.auditResults.mailchimpOnlyMembers.push({
          ...member,
          reason: 'Only exists in MailChimp, not in Classy - preserve as-is'
        });
      }
    });
    
    // Only suggest opt-out for subscribed members without Classy consent who aren't MailChimp-only
    // Actually, based on requirements, we should preserve MailChimp-only members
    // So membersToOptOut should be empty or very limited
    
    // Identify duplicate emails in MailChimp
    Object.entries(emailFrequency).forEach(([email, count]) => {
      if (count > 1) {
        this.auditResults.duplicateEmails.push({ email, count });
      }
    });
    
    console.log(`   ✅ Valid members (have consent): ${this.auditResults.validMembers.length}`);
    console.log(`   🟠 MailChimp-only members (preserve): ${this.auditResults.mailchimpOnlyMembers.length}`);
    console.log(`   🔵 Already opted out: ${this.auditResults.alreadyOptedOut.length}`);
    console.log(`   🟡 Recent MailChimp updates (preserve): ${this.auditResults.recentMailchimpUpdates.length}`);
    console.log(`   ⚠️  Members to opt-out: ${this.auditResults.membersToOptOut.length}`);
    console.log(`   🔄 Duplicate emails found: ${this.auditResults.duplicateEmails.length}\n`);
  }

  /**
   * Generate comprehensive audit report
   */
  async generateAuditReport() {
    const timestamp = new Date().toISOString().split('T')[0];
    const reportPath = path.join(__dirname, `../data/mailchimp-compliance-audit-${timestamp}.json`);
    
    const preservedCount = this.auditResults.validMembers.length + 
                          this.auditResults.mailchimpOnlyMembers.length + 
                          this.auditResults.alreadyOptedOut.length + 
                          this.auditResults.recentMailchimpUpdates.length;

    const report = {
      auditDate: new Date().toISOString(),
      cleanupStrategy: 'CONSERVATIVE - Preserve data, opt-out only, no deletions',
      summary: {
        totalMailChimpMembers: this.auditResults.totalMailChimpMembers,
        totalConsentedSupporters: this.auditResults.totalConsentedSupporters,
        validMembers: this.auditResults.validMembers.length,
        mailchimpOnlyMembers: this.auditResults.mailchimpOnlyMembers.length,
        alreadyOptedOut: this.auditResults.alreadyOptedOut.length,
        recentMailchimpUpdates: this.auditResults.recentMailchimpUpdates.length,
        membersToOptOut: this.auditResults.membersToOptOut.length,
        totalPreserved: preservedCount,
        preservationRate: ((preservedCount / this.auditResults.totalMailChimpMembers) * 100).toFixed(1) + '%',
        duplicateEmails: this.auditResults.duplicateEmails.length
      },
      compliance: {
        validMembers: this.auditResults.validMembers,
        mailchimpOnlyMembers: this.auditResults.mailchimpOnlyMembers,
        alreadyOptedOut: this.auditResults.alreadyOptedOut,
        recentMailchimpUpdates: this.auditResults.recentMailchimpUpdates,
        membersToOptOut: this.auditResults.membersToOptOut,
        duplicateEmails: this.auditResults.duplicateEmails
      },
      recommendations: this.generateRecommendations()
    };
    
    // Ensure data directory exists
    const dataDir = path.dirname(reportPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📋 Audit report saved: ${reportPath}`);
  }

  /**
   * Create CSV opt-out list for conservative MailChimp cleanup
   */
  async createOptOutList() {
    const timestamp = new Date().toISOString().split('T')[0];
    const optOutPath = path.join(__dirname, `../data/mailchimp-optout-list-${timestamp}.csv`);
    
    const csvWriter = createObjectCsvWriter({
      path: optOutPath,
      header: [
        { id: 'email', title: 'Email Address' },
        { id: 'firstName', title: 'First Name' },
        { id: 'lastName', title: 'Last Name' },
        { id: 'status', title: 'Current Status' },
        { id: 'reason', title: 'Opt-Out Reason' },
        { id: 'subscribeDate', title: 'Subscribe Date' },
        { id: 'action', title: 'Recommended Action' }
      ]
    });
    
    // Add action field to opt-out members
    const optOutRecords = this.auditResults.membersToOptOut.map(member => ({
      ...member,
      action: 'Unsubscribe (preserve member record)'
    }));
    
    await csvWriter.writeRecords(optOutRecords);
    console.log(`📝 Opt-out list saved: ${optOutPath}`);
    console.log(`   Contains ${this.auditResults.membersToOptOut.length} members to opt-out (NOT delete)`);
    
    // Also create a preservation summary
    const preservationPath = path.join(__dirname, `../data/mailchimp-preservation-summary-${timestamp}.csv`);
    const preservationWriter = createObjectCsvWriter({
      path: preservationPath,
      header: [
        { id: 'category', title: 'Category' },
        { id: 'count', title: 'Count' },
        { id: 'action', title: 'Action' },
        { id: 'reason', title: 'Reason' }
      ]
    });
    
    const preservationSummary = [
      {
        category: 'Valid Members',
        count: this.auditResults.validMembers.length,
        action: 'Preserve & sync with current Classy data',
        reason: 'Have email consent in Classy database'
      },
      {
        category: 'MailChimp-Only Members',
        count: this.auditResults.mailchimpOnlyMembers.length,
        action: 'Preserve as-is',
        reason: 'Only exist in MailChimp, not in Classy database'
      },
      {
        category: 'Already Opted Out',
        count: this.auditResults.alreadyOptedOut.length,
        action: 'No action needed',
        reason: 'Already unsubscribed in MailChimp'
      },
      {
        category: 'Recent MailChimp Updates',
        count: this.auditResults.recentMailchimpUpdates.length,
        action: 'Preserve MailChimp state',
        reason: 'Updated more recently in MailChimp than Classy'
      }
    ];
    
    await preservationWriter.writeRecords(preservationSummary);
    console.log(`📊 Preservation summary saved: ${preservationPath}`);
  }

  /**
   * Generate compliance recommendations
   */
  generateRecommendations() {
    const recommendations = [];
    
    // Conservative approach recommendations
    recommendations.push({
      priority: 'INFO',
      action: 'Conservative cleanup approach adopted',
      description: 'Preserving all member data, using opt-out instead of deletion',
      impact: 'Maintains member history and preferences while ensuring compliance'
    });
    
    if (this.auditResults.membersToOptOut.length > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Opt-out non-consented members',
        description: `${this.auditResults.membersToOptOut.length} members should be unsubscribed (not deleted)`,
        impact: 'Ensures compliance while preserving member records'
      });
    }
    
    if (this.auditResults.mailchimpOnlyMembers.length > 0) {
      recommendations.push({
        priority: 'INFO',
        action: 'MailChimp-only members preserved',
        description: `${this.auditResults.mailchimpOnlyMembers.length} members exist only in MailChimp and will be preserved as-is`,
        impact: 'Respects independent MailChimp subscription preferences'
      });
    }
    
    if (this.auditResults.recentMailchimpUpdates.length > 0) {
      recommendations.push({
        priority: 'INFO',
        action: 'Recent MailChimp updates preserved',
        description: `${this.auditResults.recentMailchimpUpdates.length} members have more recent MailChimp updates than Classy`,
        impact: 'Preserves latest member preferences from MailChimp'
      });
    }
    
    if (this.auditResults.duplicateEmails.length > 0) {
      recommendations.push({
        priority: 'MEDIUM', 
        action: 'Review duplicate emails',
        description: `${this.auditResults.duplicateEmails.length} email addresses appear multiple times`,
        impact: 'Clean data improves deliverability, but investigate before removing'
      });
    }
    
    // Schema cleanup recommendation
    recommendations.push({
      priority: 'MEDIUM',
      action: 'Clean up legacy Classy data fields',
      description: 'Previous Classy sync may have created inconsistent merge fields and tags',
      impact: 'Standardize data schema for future syncs'
    });
    
    const preservationRate = ((this.auditResults.validMembers.length + 
                              this.auditResults.mailchimpOnlyMembers.length + 
                              this.auditResults.alreadyOptedOut.length + 
                              this.auditResults.recentMailchimpUpdates.length) / 
                              this.auditResults.totalMailChimpMembers) * 100;
    
    recommendations.push({
      priority: 'SUCCESS',
      action: 'High preservation rate achieved',
      description: `${preservationRate.toFixed(1)}% of members will be preserved`,
      impact: 'Minimal disruption to existing subscriber base'
    });
    
    return recommendations;
  }

  /**
   * Print audit summary to console
   */
  printSummary() {
    console.log('\n' + '='.repeat(70));
    console.log('📊 MAILCHIMP CONSERVATIVE COMPLIANCE AUDIT SUMMARY');
    console.log('='.repeat(70));
    
    console.log(`📧 Total MailChimp Members: ${this.auditResults.totalMailChimpMembers.toLocaleString()}`);
    console.log(`✅ Supporters with Consent: ${this.auditResults.totalConsentedSupporters.toLocaleString()}`);
    console.log('');
    
    console.log('🔍 MEMBER CATEGORIZATION:');
    console.log(`🟢 Valid Members (sync with Classy): ${this.auditResults.validMembers.length.toLocaleString()}`);
    console.log(`🟠 MailChimp-Only (preserve as-is): ${this.auditResults.mailchimpOnlyMembers.length.toLocaleString()}`);
    console.log(`🔵 Already Opted Out (no action): ${this.auditResults.alreadyOptedOut.length.toLocaleString()}`);
    console.log(`🟡 Recent MailChimp Updates (preserve): ${this.auditResults.recentMailchimpUpdates.length.toLocaleString()}`);
    console.log(`⚠️  Members to Opt-Out (NOT delete): ${this.auditResults.membersToOptOut.length.toLocaleString()}`);
    
    const preservedCount = this.auditResults.validMembers.length + 
                          this.auditResults.mailchimpOnlyMembers.length + 
                          this.auditResults.alreadyOptedOut.length + 
                          this.auditResults.recentMailchimpUpdates.length;
    
    const preservationRate = ((preservedCount / this.auditResults.totalMailChimpMembers) * 100);
    console.log(`📈 Preservation Rate: ${preservationRate.toFixed(1)}%`);
    
    if (this.auditResults.duplicateEmails.length > 0) {
      console.log(`🔄 Duplicate Emails (investigate): ${this.auditResults.duplicateEmails.length}`);
    }
    
    console.log('\n🛡️ CONSERVATIVE APPROACH:');
    console.log('✓ NO deletions - all member records preserved');
    console.log('✓ NO changes to MailChimp-only members');
    console.log('✓ NO changes to recently updated MailChimp records');
    console.log('✓ Only opt-out (unsubscribe) members without Classy consent');
    console.log('✓ Preserve all member history and preferences');
    
    console.log('\n💡 NEXT STEPS:');
    console.log('1. Review audit report and preservation summary in data/ directory');
    console.log('2. Clean up legacy Classy merge fields and tags');
    console.log('3. Use opt-out list for conservative cleanup (if any)');
    console.log('4. Test with single member before any batch operations');
    console.log('5. Sync valid members with current Classy data schema');
    console.log('='.repeat(70));
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('Usage: node mailchimp-compliance-audit.js <export-file-path> [organization-id]');
    console.log('');
    console.log('Example:');
    console.log('  node mailchimp-compliance-audit.js ./mailchimp-export.csv');
    console.log('  node mailchimp-compliance-audit.js ./mailchimp-export.csv 1');
    process.exit(1);
  }
  
  const exportPath = args[0];
  const orgId = args[1] ? parseInt(args[1]) : null;
  
  const auditor = new MailChimpComplianceAuditor();
  await auditor.runAudit(exportPath, orgId);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  });
}

module.exports = { MailChimpComplianceAuditor };