#!/usr/bin/env node

/**
 * Analyze the Classy API documentation JSON file
 * Extract endpoints, schemas, and parameters relevant to our sync system
 */

const fs = require('fs');
const path = require('path');

function analyzeApiDocs() {
  try {
    // Load the API documentation JSON
    const apiDocsPath = path.join(__dirname, '../data/apiv2-public.json');
    const apiDocs = JSON.parse(fs.readFileSync(apiDocsPath, 'utf8'));
    
    console.log('🔍 Analyzing GoFundMe Pro API Documentation...');
    console.log(`📊 API Version: ${apiDocs.info.version}`);
    console.log(`🌐 Base URL: ${apiDocs.servers[0].url}`);
    
    // Extract all paths
    const paths = apiDocs.paths;
    const pathKeys = Object.keys(paths);
    
    console.log(`\n📋 Total Endpoints: ${pathKeys.length}`);
    
    // Analyze endpoints by category
    const categories = {
      transactions: [],
      supporters: [],
      campaigns: [],
      organizations: [],
      recurring: [],
      other: []
    };
    
    pathKeys.forEach(pathKey => {
      const methods = Object.keys(paths[pathKey]);
      methods.forEach(method => {
        const endpoint = {
          path: pathKey,
          method: method.toUpperCase(),
          operation: paths[pathKey][method],
          summary: paths[pathKey][method].summary || 'No summary',
          tags: paths[pathKey][method].tags || []
        };
        
        // Categorize endpoints
        if (pathKey.includes('transaction')) {
          categories.transactions.push(endpoint);
        } else if (pathKey.includes('supporter')) {
          categories.supporters.push(endpoint);
        } else if (pathKey.includes('campaign')) {
          categories.campaigns.push(endpoint);
        } else if (pathKey.includes('organization')) {
          categories.organizations.push(endpoint);
        } else if (pathKey.includes('recurring') || pathKey.includes('donation-plan')) {
          categories.recurring.push(endpoint);
        } else {
          categories.other.push(endpoint);
        }
      });
    });
    
    // Print analysis by category
    Object.entries(categories).forEach(([category, endpoints]) => {
      if (endpoints.length > 0) {
        console.log(`\n🏷️  ${category.toUpperCase()} ENDPOINTS (${endpoints.length}):`);
        endpoints.forEach(endpoint => {
          console.log(`   ${endpoint.method} ${endpoint.path}`);
          console.log(`      ${endpoint.summary}`);
        });
      }
    });
    
    // Analyze schemas
    if (apiDocs.components && apiDocs.components.schemas) {
      const schemas = Object.keys(apiDocs.components.schemas);
      console.log(`\n📦 SCHEMAS (${schemas.length}):`);
      
      const relevantSchemas = schemas.filter(schema => 
        schema.toLowerCase().includes('transaction') ||
        schema.toLowerCase().includes('supporter') ||
        schema.toLowerCase().includes('campaign') ||
        schema.toLowerCase().includes('recurring')
      );
      
      relevantSchemas.forEach(schemaName => {
        console.log(`   📋 ${schemaName}`);
        const schema = apiDocs.components.schemas[schemaName];
        if (schema.properties) {
          const properties = Object.keys(schema.properties);
          console.log(`      Fields: ${properties.length} (${properties.slice(0, 5).join(', ')}${properties.length > 5 ? '...' : ''})`);
        }
      });
    }
    
    return {
      categories,
      schemas: apiDocs.components?.schemas || {},
      totalEndpoints: pathKeys.length
    };
    
  } catch (error) {
    console.error('❌ Failed to analyze API docs:', error.message);
    process.exit(1);
  }
}

function analyzeSpecificEndpoint(searchTerm) {
  try {
    const apiDocsPath = path.join(__dirname, '../data/apiv2-public.json');
    const apiDocs = JSON.parse(fs.readFileSync(apiDocsPath, 'utf8'));
    
    console.log(`🔍 Searching for endpoints containing: "${searchTerm}"`);
    
    const paths = apiDocs.paths;
    const matchingEndpoints = [];
    
    Object.entries(paths).forEach(([pathKey, pathData]) => {
      if (pathKey.toLowerCase().includes(searchTerm.toLowerCase())) {
        Object.entries(pathData).forEach(([method, operation]) => {
          matchingEndpoints.push({
            path: pathKey,
            method: method.toUpperCase(),
            operation
          });
        });
      }
    });
    
    if (matchingEndpoints.length === 0) {
      console.log(`❌ No endpoints found containing "${searchTerm}"`);
      return;
    }
    
    matchingEndpoints.forEach(endpoint => {
      console.log(`\n📍 ${endpoint.method} ${endpoint.path}`);
      console.log(`   Summary: ${endpoint.operation.summary || 'No summary'}`);
      console.log(`   Description: ${endpoint.operation.description || 'No description'}`);
      
      if (endpoint.operation.parameters) {
        console.log(`   Parameters (${endpoint.operation.parameters.length}):`);
        endpoint.operation.parameters.forEach(param => {
          console.log(`     • ${param.name} (${param.in}): ${param.description || 'No description'}`);
          if (param.schema) {
            console.log(`       Type: ${param.schema.type}, Required: ${param.required}`);
          }
        });
      }
      
      if (endpoint.operation.responses) {
        const responseKeys = Object.keys(endpoint.operation.responses);
        console.log(`   Responses: ${responseKeys.join(', ')}`);
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to analyze specific endpoint:', error.message);
    process.exit(1);
  }
}

function analyzeSchema(schemaName) {
  try {
    const apiDocsPath = path.join(__dirname, '../data/apiv2-public.json');
    const apiDocs = JSON.parse(fs.readFileSync(apiDocsPath, 'utf8'));
    
    if (!apiDocs.components || !apiDocs.components.schemas) {
      console.log('❌ No schemas found in API docs');
      return;
    }
    
    const schema = apiDocs.components.schemas[schemaName];
    if (!schema) {
      console.log(`❌ Schema "${schemaName}" not found`);
      const availableSchemas = Object.keys(apiDocs.components.schemas);
      console.log(`Available schemas: ${availableSchemas.join(', ')}`);
      return;
    }
    
    console.log(`\n📋 SCHEMA: ${schemaName}`);
    console.log(`   Type: ${schema.type || 'Not specified'}`);
    console.log(`   Description: ${schema.description || 'No description'}`);
    
    if (schema.properties) {
      const properties = Object.entries(schema.properties);
      console.log(`\n   Properties (${properties.length}):`);
      
      properties.forEach(([propName, propData]) => {
        console.log(`     • ${propName}: ${propData.type || 'unknown type'}`);
        if (propData.description) {
          console.log(`       ${propData.description}`);
        }
        if (propData.example !== undefined) {
          console.log(`       Example: ${propData.example}`);
        }
      });
    }
    
    if (schema.required) {
      console.log(`\n   Required fields: ${schema.required.join(', ')}`);
    }
    
  } catch (error) {
    console.error('❌ Failed to analyze schema:', error.message);
    process.exit(1);
  }
}

// Command line interface
const command = process.argv[2];
const argument = process.argv[3];

switch (command) {
  case 'overview':
    analyzeApiDocs();
    break;
  case 'endpoint':
    if (!argument) {
      console.error('❌ Please provide a search term: node analyze-api-docs.js endpoint transactions');
      process.exit(1);
    }
    analyzeSpecificEndpoint(argument);
    break;
  case 'schema':
    if (!argument) {
      console.error('❌ Please provide a schema name: node analyze-api-docs.js schema Transaction');
      process.exit(1);
    }
    analyzeSchema(argument);
    break;
  default:
    console.log('🔍 GoFundMe Pro API Documentation Analyzer');
    console.log('');
    console.log('Usage:');
    console.log('  node analyze-api-docs.js overview              # Full overview');
    console.log('  node analyze-api-docs.js endpoint [search]     # Search endpoints');
    console.log('  node analyze-api-docs.js schema [name]         # Analyze schema');
    console.log('');
    console.log('Examples:');
    console.log('  node analyze-api-docs.js endpoint transactions');
    console.log('  node analyze-api-docs.js endpoint supporters');
    console.log('  node analyze-api-docs.js schema Transaction');
    console.log('  node analyze-api-docs.js schema Supporter');
    break;
}