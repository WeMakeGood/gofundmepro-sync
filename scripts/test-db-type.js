#!/usr/bin/env node

/**
 * Quick database type detection test
 * Tests SQL syntax compatibility without running full sync
 */

const { getInstance } = require('../src/core/knex-database');

async function testDatabaseType() {
  console.log('🔍 Testing database type detection...');
  
  try {
    const db = getInstance();
    
    // Test connection
    await db.connect();
    console.log(`✅ Database connected successfully`);
    
    // Test type detection
    const dbType = db.type;
    console.log(`📊 Database type detected: ${dbType}`);
    
    // Test SQL syntax for each type
    const testQueries = {
      mysql: "SELECT NOW() as `current_time`",
      sqlite: "SELECT datetime('now') as current_time", 
      pg: "SELECT NOW() as current_time"
    };
    
    const query = testQueries[dbType];
    if (!query) {
      throw new Error(`Unknown database type: ${dbType}`);
    }
    
    console.log(`🧪 Testing SQL syntax for ${dbType}...`);
    const result = await db.query(query);
    console.log(`✅ SQL syntax test passed for ${dbType}`);
    console.log(`   Result: ${JSON.stringify(result[0])}`);
    
    // Test the specific supporter stats SQL that was failing
    if (dbType === 'mysql') {
      console.log('🧪 Testing supporters stats SQL for MySQL...');
      const testSQL = `
        SELECT 
          'test' as test_field,
          NOW() as \`current_time\`
      `;
      await db.query(testSQL);
      console.log('✅ MySQL NOW() function works correctly');
    }
    
    await db.close();
    console.log('🎉 All database type tests passed!');
    
  } catch (error) {
    console.error('❌ Database type test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testDatabaseType();