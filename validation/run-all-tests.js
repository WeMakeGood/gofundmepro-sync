#!/usr/bin/env node

require('dotenv').config();
const logger = require('./logger');

const testAuth = require('./test-auth');
const testAPIResponses = require('./test-api-responses');
const testFiltering = require('./test-filtering');
const analyzeDataStructures = require('./analyze-data-structures');

/**
 * Master test runner for Classy API validation
 */

async function runAllTests() {
  logger.info('🚀 Starting Classy API Validation Test Suite...');
  
  const results = {
    authentication: null,
    apiResponses: null,
    filtering: null,
    dataStructures: null
  };

  let allTestsPassed = true;

  try {
    // Test 1: Authentication
    logger.info('\n' + '='.repeat(60));
    logger.info('TEST 1: AUTHENTICATION');
    logger.info('='.repeat(60));
    
    results.authentication = await testAuth();
    if (!results.authentication.success) {
      logger.error('❌ Authentication failed - stopping test suite');
      allTestsPassed = false;
      return { success: false, results };
    }

    // Test 2: API Responses
    logger.info('\n' + '='.repeat(60));
    logger.info('TEST 2: API RESPONSE VALIDATION');
    logger.info('='.repeat(60));
    
    results.apiResponses = await testAPIResponses();
    if (!results.apiResponses.success) {
      logger.error('❌ API response validation failed');
      allTestsPassed = false;
    }

    // Test 3: Filtering
    logger.info('\n' + '='.repeat(60));
    logger.info('TEST 3: SERVER-SIDE FILTERING');
    logger.info('='.repeat(60));
    
    results.filtering = await testFiltering();
    if (!results.filtering.success) {
      logger.error('❌ Filtering validation failed');
      allTestsPassed = false;
    }

    // Test 4: Data Structure Analysis
    logger.info('\n' + '='.repeat(60));
    logger.info('TEST 4: DATA STRUCTURE ANALYSIS');
    logger.info('='.repeat(60));
    
    results.dataStructures = await analyzeDataStructures();
    if (!results.dataStructures.success) {
      logger.error('❌ Data structure analysis failed');
      allTestsPassed = false;
    }

    // Final Summary
    logger.info('\n' + '='.repeat(60));
    logger.info('TEST SUITE SUMMARY');
    logger.info('='.repeat(60));

    const testSummary = [
      { name: 'Authentication', status: results.authentication?.success ? '✅ PASS' : '❌ FAIL' },
      { name: 'API Responses', status: results.apiResponses?.success ? '✅ PASS' : '❌ FAIL' },
      { name: 'Filtering', status: results.filtering?.success ? '✅ PASS' : '❌ FAIL' },
      { name: 'Data Analysis', status: results.dataStructures?.success ? '✅ PASS' : '❌ FAIL' }
    ];

    testSummary.forEach(test => {
      logger.info(`${test.name}: ${test.status}`);
    });

    if (allTestsPassed) {
      logger.info('\n🎉 All tests passed! Ready to proceed with implementation.');
      logger.info('📊 Check validation/data-structure-analysis.json for detailed findings.');
    } else {
      logger.error('\n❌ Some tests failed. Review issues before implementing.');
    }

    return { success: allTestsPassed, results };

  } catch (error) {
    logger.error('💥 Test suite crashed:', error.message);
    return { success: false, error: error.message, results };
  }
}

// Run if called directly
if (require.main === module) {
  runAllTests()
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      logger.error('Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = runAllTests;