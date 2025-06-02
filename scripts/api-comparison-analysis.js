#!/usr/bin/env node

/**
 * Compare our current sync implementation with the official Classy API documentation
 * Identify missing fields, incorrect endpoints, and optimization opportunities
 */

console.log('🔍 Analyzing Current Sync Implementation vs Official API Documentation');
console.log('==================================================================');

// Our current field mappings vs API documentation
const apiComparison = {
  transactions: {
    currentEndpoint: '/organizations/{id}/transactions',
    apiDocumentation: {
      endpoint: '✅ /organizations/{organization_id}/transactions',
      method: 'GET',
      summary: 'listOrganizationTransactions',
      description: 'List Organization Transactions',
      supportsFiltering: true,
      supportsPagination: true,
      maxPerPage: 100
    },
    
    currentFields: [
      'id', 'supporter_id', 'campaign_id', 'gross_amount', 'net_amount', 
      'fees_amount', 'status', 'transaction_type', 'purchased_at', 'updated_at',
      'payment_method', 'payment_gateway', 'billing_first_name', 'billing_last_name',
      'member_email_address', 'company_name', 'billing_address1', 'billing_city',
      'billing_state', 'billing_postal_code', 'billing_country'
    ],
    
    apiFields: [
      // Core identifiers (✅ we have these)
      'id', 'organization_id', 'campaign_id', 'member_id', 'supporter_id',
      
      // Financial fields (⚠️ some missing)
      'total_gross_amount', 'donation_gross_amount', 'fees_amount', 
      'charged_total_gross_amount', 'charged_fees_amount', 'charged_currency_code',
      'raw_total_gross_amount', 'raw_donation_gross_amount', 'raw_currency_code',
      
      // Dates (✅ we have these)
      'purchased_at', 'created_at', 'updated_at', 'charged_at', 'refunded_at',
      
      // Payment info (✅ we have most)
      'payment_gateway', 'payment_method', 'payment_type', 'card_type', 'card_last_four',
      
      // Status and type (⚠️ status values more detailed)
      'status', 'frequency', 'is_anonymous', 'hide_amount',
      
      // Billing (✅ we have these)
      'billing_first_name', 'billing_last_name', 'member_email_address',
      'billing_address1', 'billing_city', 'billing_state', 'billing_postal_code', 'billing_country',
      
      // Missing advanced fields
      'designation_id', 'fundraising_page_id', 'fundraising_team_id', 
      'recurring_donation_plan_id', 'fee_on_top', 'is_donor_covered_fee'
    ],
    
    recommendations: [
      '✅ Using correct organization-level endpoint',
      '⚠️ Missing raw currency fields (raw_total_gross_amount, raw_currency_code)',
      '⚠️ Missing charged currency fields (charged_total_gross_amount, charged_currency_code)', 
      '⚠️ Missing relationship IDs (fundraising_page_id, fundraising_team_id)',
      '⚠️ Missing fee-related flags (fee_on_top, is_donor_covered_fee)',
      '✅ Field mapping looks mostly correct'
    ]
  },

  supporters: {
    currentEndpoint: '/organizations/{id}/supporters',
    apiDocumentation: {
      endpoint: '✅ /organizations/{organization_id}/supporters',
      method: 'GET', 
      summary: 'listOrganizationSupporters',
      description: 'Retrieves a list of all Supporters for a specific Organization',
      supportsFiltering: true,
      supportsPagination: true,
      maxPerPage: 100
    },
    
    currentFields: [
      'id', 'email_address', 'first_name', 'last_name', 'phone',
      'address1', 'address2', 'city', 'state', 'postal_code', 'country',
      'opt_in', 'sms_opt_in', 'last_email_consent_decision_date',
      'last_sms_consent_decision_date', 'last_emailed_at',
      'created_at', 'updated_at'
    ],
    
    apiFields: [
      // Core identifiers (✅ we have these)
      'id', 'member_id',
      
      // Contact info (✅ we have these)
      'email_address', 'first_name', 'last_name', 'phone',
      
      // Address (✅ we have these)
      'address1', 'address2', 'city', 'state', 'postal_code', 'country',
      
      // Communication preferences (⚠️ different field names)
      'opt_in', 'last_emailed_at',
      
      // Dates (✅ we have these)
      'created_at', 'updated_at',
      
      // Missing fields from API
      'gender', 'nickname', 'location', 'origin', 'metadata',
      'source_campaign_id', 'source_fundraising_page_id', 'source_member_id', 'source_organization_id'
    ],
    
    recommendations: [
      '✅ Using correct organization-level endpoint',
      '⚠️ API uses "opt_in" not "sms_opt_in" - check if this exists in API',
      '⚠️ Custom consent date fields not in API schema - may be custom fields',
      '⚠️ Missing source tracking fields (source_campaign_id, source_fundraising_page_id)',
      '⚠️ Missing demographic fields (gender, nickname, location)',
      '✅ Core contact fields look correct'
    ]
  },

  campaigns: {
    currentEndpoint: '/organizations/{id}/campaigns',
    apiDocumentation: {
      endpoint: '✅ /organizations/{org_id}/campaigns',
      method: 'GET',
      summary: 'listOrganizationCampaigns', 
      description: 'List campaigns for an organization',
      supportsFiltering: true,
      supportsPagination: true,
      maxPerPage: 100
    },
    
    currentFields: [
      'id', 'organization_id', 'name', 'status', 'goal', 'total_raised',
      'donor_count', 'campaign_type', 'start_date', 'end_date',
      'created_at', 'updated_at'
    ],
    
    apiFields: [
      // Core (✅ we have these)
      'id', 'name', 'status', 'goal', 'total_raised', 'donors_count',
      
      // Type and dates (⚠️ different field names)
      'type', 'started_at', 'ended_at', 'created_at', 'updated_at',
      
      // Many additional fields in API (100+ fields total)
      'description', 'canonical_url', 'category_id', 'channel_id',
      'currency_code', 'timezone_identifier', 'allow_duplicate_donations',
      'is_team_fundraising_enabled', 'is_recurring_enabled'
    ],
    
    recommendations: [
      '✅ Using correct organization-level endpoint',
      '⚠️ API uses "started_at/ended_at" not "start_date/end_date"',
      '⚠️ API uses "type" not "campaign_type"', 
      '⚠️ API uses "donors_count" not "donor_count"',
      '⚠️ Missing many campaign settings fields available in API',
      '✅ Core campaign data mapping is mostly correct'
    ]
  },

  recurringPlans: {
    currentEndpoint: '/organizations/{id}/recurring-donation-plans',
    apiDocumentation: {
      endpoint: '✅ /organizations/{organization_id}/recurring-donation-plans',
      method: 'GET',
      summary: 'listOrganizationRecurringDonationPlans',
      description: 'List organization recurring donation plans',
      supportsFiltering: true,
      supportsPagination: true,
      maxPerPage: 100
    },
    
    currentFields: [
      'id', 'supporter_id', 'campaign_id', 'amount', 'frequency', 'status',
      'start_date', 'next_process_date', 'last_process_date', 'end_date',
      'created_at', 'updated_at'
    ],
    
    apiFields: [
      // Core (✅ we have these)
      'id', 'campaign_id', 'amount', 'frequency', 'status',
      
      // Member relationship (⚠️ we use supporter_id, API shows member_id)
      'member_id', 'supporter_id',
      
      // Dates (⚠️ different field names)
      'start_date', 'next_process_date', 'last_process_date', 'canceled_at',
      'created_at', 'updated_at',
      
      // Many additional fields (60+ total)
      'currency_code', 'raw_amount', 'applied_fot_percent',
      'payment_gateway', 'payment_method', 'card_type', 'card_last_four'
    ],
    
    recommendations: [
      '✅ Using correct organization-level endpoint',
      '⚠️ API has both member_id and supporter_id - verify relationship',
      '⚠️ API uses "canceled_at" not "end_date"',
      '⚠️ Missing payment method fields available in API',
      '⚠️ Missing currency and fee fields',
      '✅ Core recurring plan data is mostly correct'
    ]
  }
};

// Performance and optimization opportunities
const performanceRecommendations = {
  pagination: {
    current: 'Using batch_size parameter (100)',
    apiRecommendation: 'Use per_page parameter (max 100) ✅ Correct',
    improvement: 'Consider using smaller batches for slow endpoints like supporters'
  },
  
  filtering: {
    current: 'Client-side filtering after fetch',
    apiRecommendation: 'Use filter parameter for server-side filtering',
    improvement: 'Implement proper API filtering: filter[updated_at]>=2024-01-01T00:00:00Z'
  },
  
  relationships: {
    current: 'Separate API calls for related data',
    apiRecommendation: 'Use "with" parameter to include relationships',
    improvement: 'Use with=supporter,campaign,items to reduce API calls'
  },
  
  fields: {
    current: 'Fetching all fields',
    apiRecommendation: 'Use "fields" parameter to limit response size',
    improvement: 'Only fetch needed fields for better performance'
  }
};

// Print analysis
console.log('\n📊 ENDPOINT ANALYSIS');
console.log('====================');

Object.entries(apiComparison).forEach(([entity, analysis]) => {
  console.log(`\n🏷️  ${entity.toUpperCase()}`);
  console.log(`   Current: ${analysis.currentEndpoint}`);
  console.log(`   API Doc: ${analysis.apiDocumentation.endpoint}`);
  console.log(`   Max per page: ${analysis.apiDocumentation.maxPerPage}`);
  
  console.log('\n   📋 Recommendations:');
  analysis.recommendations.forEach(rec => {
    console.log(`     ${rec}`);
  });
});

console.log('\n⚡ PERFORMANCE OPTIMIZATION OPPORTUNITIES');
console.log('==========================================');

Object.entries(performanceRecommendations).forEach(([category, rec]) => {
  console.log(`\n🎯 ${category.toUpperCase()}`);
  console.log(`   Current: ${rec.current}`);
  console.log(`   API Best Practice: ${rec.apiRecommendation}`);
  console.log(`   💡 Improvement: ${rec.improvement}`);
});

console.log('\n🔍 SPECIFIC FIELD MAPPING ISSUES FOUND');
console.log('======================================');

const fieldIssues = [
  {
    entity: 'Campaigns',
    issue: 'Field name mismatches',
    current: ['campaign_type', 'start_date', 'end_date', 'donor_count'],
    correct: ['type', 'started_at', 'ended_at', 'donors_count'],
    impact: 'May cause data sync issues or missing data'
  },
  {
    entity: 'Transactions', 
    issue: 'Missing currency fields',
    current: ['gross_amount', 'net_amount'],
    missing: ['raw_total_gross_amount', 'charged_total_gross_amount', 'currency_code'],
    impact: 'Currency conversion and multi-currency support issues'
  },
  {
    entity: 'Supporters',
    issue: 'Custom consent fields',
    current: ['sms_opt_in', 'last_email_consent_decision_date'],
    note: 'These may be organization-specific custom fields not in base API',
    impact: 'Need to verify if these exist in API response'
  }
];

fieldIssues.forEach(issue => {
  console.log(`\n⚠️  ${issue.entity}: ${issue.issue}`);
  if (issue.current) console.log(`   Current: ${issue.current.join(', ')}`);
  if (issue.correct) console.log(`   Should be: ${issue.correct.join(', ')}`);
  if (issue.missing) console.log(`   Missing: ${issue.missing.join(', ')}`);
  if (issue.note) console.log(`   Note: ${issue.note}`);
  console.log(`   Impact: ${issue.impact}`);
});

console.log('\n✅ RECOMMENDED NEXT STEPS');
console.log('=========================');

const nextSteps = [
  '1. Fix campaign field names (type, started_at, ended_at, donors_count)',
  '2. Add currency fields to transaction sync (raw_*, charged_*, currency_code)',
  '3. Implement server-side filtering using filter parameter',
  '4. Use "with" parameter to include relationships and reduce API calls',
  '5. Add "fields" parameter to optimize response sizes',
  '6. Verify supporter consent fields exist in actual API responses',
  '7. Add missing relationship IDs (fundraising_page_id, fundraising_team_id)',
  '8. Test smaller batch sizes for supporters endpoint performance'
];

nextSteps.forEach(step => console.log(`   ${step}`));

console.log('\n🎯 PRIORITY FIXES');
console.log('=================');
console.log('   🚨 HIGH: Fix campaign field name mismatches');
console.log('   🔄 MEDIUM: Add currency fields to transactions');  
console.log('   ⚡ LOW: Implement server-side filtering optimization');

console.log('\n📝 Note: This analysis is based on the official API documentation.');
console.log('   Test any changes in development environment first.');