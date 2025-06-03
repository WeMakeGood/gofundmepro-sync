#!/usr/bin/env node

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const logger = require('./logger');
const testAuth = require('./test-auth');

/**
 * Test 4: Data Structure Analysis
 * 
 * Analyzes:
 * - Actual field names, types, and nullability
 * - Data format patterns (dates, numbers, strings)
 * - Relationship field availability
 * - Generates recommended database schema
 */

async function analyzeDataStructures() {
  logger.info('🔬 Analyzing Classy API Data Structures...');

  const authResult = await testAuth();
  if (!authResult.success) {
    logger.error('❌ Authentication failed, cannot analyze data structures');
    return { success: false };
  }

  const { accessToken } = authResult;
  const organizationId = process.env.CLASSY_ORGANIZATION_ID;
  const sampleSize = 20; // Analyze more records for better patterns

  const baseHeaders = {
    'Authorization': `Bearer ${accessToken}`,
    'User-Agent': 'ClassySync-Validation/2.0'
  };

  try {
    const entityAnalysis = {};

    const entities = [
      { name: 'supporters', endpoint: `/2.0/organizations/${organizationId}/supporters` },
      { name: 'transactions', endpoint: `/2.0/organizations/${organizationId}/transactions` },
      { name: 'campaigns', endpoint: `/2.0/organizations/${organizationId}/campaigns` },
      { name: 'recurringPlans', endpoint: `/2.0/organizations/${organizationId}/recurring-donation-plans` }
    ];

    for (const entity of entities) {
      logger.info(`Analyzing ${entity.name} data structure...`);

      try {
        const response = await axios.get(`https://api.classy.org${entity.endpoint}`, {
          headers: baseHeaders,
          params: {
            per_page: sampleSize,
            page: 1
          }
        });

        if (!response.data.data || response.data.data.length === 0) {
          logger.warn(`No data available for ${entity.name} analysis`);
          entityAnalysis[entity.name] = { available: false };
          continue;
        }

        const records = response.data.data;
        const analysis = analyzeRecords(entity.name, records);
        entityAnalysis[entity.name] = analysis;

        logger.info(`✅ ${entity.name} analysis complete:`, {
          records: records.length,
          fields: Object.keys(analysis.fieldAnalysis).length,
          requiredFields: Object.values(analysis.fieldAnalysis).filter(f => f.nullCount === 0).length
        });

      } catch (error) {
        logger.error(`❌ Failed to analyze ${entity.name}:`, error.message);
        entityAnalysis[entity.name] = { 
          available: false, 
          error: error.message 
        };
      }
    }

    // Generate schema recommendations
    const schemaRecommendations = generateSchemaRecommendations(entityAnalysis);

    // Save analysis results
    const analysisReport = {
      timestamp: new Date().toISOString(),
      organizationId,
      sampleSize,
      entityAnalysis,
      schemaRecommendations
    };

    fs.writeFileSync(
      'validation/data-structure-analysis.json',
      JSON.stringify(analysisReport, null, 2)
    );

    logger.info('📊 Data Structure Analysis Summary:');
    Object.entries(entityAnalysis).forEach(([entity, analysis]) => {
      if (analysis.available !== false) {
        logger.info(`${entity}:`, {
          fields: Object.keys(analysis.fieldAnalysis || {}).length,
          criticalIssues: analysis.criticalIssues?.length || 0
        });
      }
    });

    logger.info('💾 Detailed analysis saved to validation/data-structure-analysis.json');

    return {
      success: true,
      analysis: entityAnalysis,
      recommendations: schemaRecommendations
    };

  } catch (error) {
    logger.error('❌ Data structure analysis failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Analyze a set of records to understand field patterns
 */
function analyzeRecords(entityName, records) {
  const fieldAnalysis = {};
  const criticalIssues = [];

  // Analyze each field across all records
  records.forEach((record, index) => {
    Object.entries(record).forEach(([fieldName, value]) => {
      if (!fieldAnalysis[fieldName]) {
        fieldAnalysis[fieldName] = {
          type: null,
          nullable: false,
          nullCount: 0,
          sampleValues: [],
          patterns: new Set()
        };
      }

      const field = fieldAnalysis[fieldName];
      
      if (value === null || value === undefined) {
        field.nullable = true;
        field.nullCount++;
      } else {
        // Determine type
        const valueType = Array.isArray(value) ? 'array' : typeof value;
        if (field.type === null) {
          field.type = valueType;
        } else if (field.type !== valueType) {
          field.type = 'mixed';
        }

        // Collect sample values (first 5 unique)
        if (field.sampleValues.length < 5 && !field.sampleValues.includes(value)) {
          field.sampleValues.push(value);
        }

        // Analyze patterns for specific field types
        if (fieldName.includes('_at') || fieldName.includes('date')) {
          field.patterns.add(getDatePattern(value));
        } else if (fieldName.includes('amount') || fieldName.includes('count')) {
          field.patterns.add(getNumberPattern(value));
        }
      }
    });
  });

  // Convert patterns sets to arrays for JSON serialization
  Object.values(fieldAnalysis).forEach(field => {
    field.patterns = Array.from(field.patterns);
  });

  // Check for critical issues based on our implementation assumptions
  criticalIssues.push(...checkCriticalFields(entityName, fieldAnalysis));

  return {
    recordCount: records.length,
    fieldAnalysis,
    criticalIssues,
    available: true
  };
}

/**
 * Check for critical field issues based on our implementation assumptions
 */
function checkCriticalFields(entityName, fieldAnalysis) {
  const issues = [];

  // Common required fields
  if (!fieldAnalysis.id) {
    issues.push(`Missing 'id' field for ${entityName}`);
  } else if (fieldAnalysis.id.nullable) {
    issues.push(`'id' field is nullable for ${entityName}`);
  }

  // Entity-specific checks
  switch (entityName) {
    case 'supporters':
      if (!fieldAnalysis.email_address) {
        issues.push('Missing email_address field');
      }
      break;

    case 'campaigns':
      if (fieldAnalysis.campaign_type && !fieldAnalysis.type) {
        issues.push('Found campaign_type instead of type field');
      }
      if (fieldAnalysis.start_date && !fieldAnalysis.started_at) {
        issues.push('Found start_date instead of started_at field');
      }
      if (fieldAnalysis.end_date && !fieldAnalysis.ended_at) {
        issues.push('Found end_date instead of ended_at field');
      }
      if (fieldAnalysis.donor_count && !fieldAnalysis.donors_count) {
        issues.push('Found donor_count instead of donors_count field');
      }
      break;

    case 'transactions':
      if (!fieldAnalysis.supporter_id) {
        issues.push('Missing supporter_id field');
      }
      if (!fieldAnalysis.raw_currency_code) {
        issues.push('Missing multi-currency support (raw_currency_code)');
      }
      break;
  }

  return issues;
}

/**
 * Analyze date field patterns
 */
function getDatePattern(value) {
  if (typeof value !== 'string') return 'non-string';
  
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    return 'iso-datetime';
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return 'simple-date';
  } else {
    return 'other-format';
  }
}

/**
 * Analyze number field patterns
 */
function getNumberPattern(value) {
  const num = parseFloat(value);
  if (isNaN(num)) return 'non-numeric';
  
  if (Number.isInteger(num)) return 'integer';
  return 'decimal';
}

/**
 * Generate database schema recommendations based on analysis
 */
function generateSchemaRecommendations(entityAnalysis) {
  const recommendations = {};

  Object.entries(entityAnalysis).forEach(([entityName, analysis]) => {
    if (analysis.available === false) return;

    const tableRecommendation = {
      tableName: entityName === 'recurringPlans' ? 'recurring_plans' : entityName,
      fields: {}
    };

    Object.entries(analysis.fieldAnalysis).forEach(([fieldName, field]) => {
      let sqlType = 'TEXT';
      let constraints = [];

      // Determine SQL type based on analysis
      if (fieldName === 'id') {
        sqlType = 'BIGINT';
        constraints.push('PRIMARY KEY');
      } else if (fieldName.includes('amount') && field.type === 'number') {
        sqlType = 'DECIMAL(10,2)';
      } else if (fieldName.includes('count') && field.type === 'number') {
        sqlType = 'INTEGER';
      } else if (fieldName.includes('_id') && field.type === 'number') {
        sqlType = 'BIGINT';
      } else if (fieldName.includes('_at') || fieldName.includes('date')) {
        sqlType = 'TIMESTAMP';
      } else if (field.type === 'boolean') {
        sqlType = 'BOOLEAN';
      } else if (field.type === 'number') {
        sqlType = field.patterns.includes('integer') ? 'INTEGER' : 'DECIMAL(10,2)';
      } else if (field.type === 'object' || field.type === 'array') {
        sqlType = 'JSON';
      }

      // Add nullable constraint
      if (!field.nullable) {
        constraints.push('NOT NULL');
      }

      tableRecommendation.fields[fieldName] = {
        type: sqlType,
        constraints,
        nullable: field.nullable,
        analysisNotes: {
          sampleValues: field.sampleValues.slice(0, 3),
          patterns: field.patterns
        }
      };
    });

    recommendations[entityName] = tableRecommendation;
  });

  return recommendations;
}

// Run test if called directly
if (require.main === module) {
  analyzeDataStructures()
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      logger.error('Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = analyzeDataStructures;