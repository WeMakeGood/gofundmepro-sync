/**
 * Check Classy Supporter Fields
 * 
 * Examine what fields Classy API actually provides for supporters,
 * especially email consent/opt-in related fields
 */

const { ClassyAPIClient } = require('../src/classy/api-client');
const { organizationManager } = require('../src/services/organization-manager');
const { database } = require('../src/config/database');
const { createLogger } = require('../src/utils/logger');

const logger = createLogger('classy-supporter-fields');

async function checkSupporterFields() {
  try {
    await database.initialize();
    
    // Get organization credentials
    const orgs = await organizationManager.listOrganizations();
    if (orgs.length === 0) {
      throw new Error('No organizations found');
    }
    
    const org = orgs[0];
    const credentials = await organizationManager.getClassyCredentials(org.id);
    
    // Initialize API client
    const apiClient = new ClassyAPIClient();
    apiClient.setCredentials(credentials);
    
    console.log(`🔍 Checking supporter fields from Classy API`);
    console.log(`Organization: ${org.name} (Classy ID: ${org.classy_id})\n`);
    
    // Get a few supporters to examine their fields
    const supporters = await apiClient.getSupporters(org.classy_id, { limit: 5 });
    
    console.log(`📊 Retrieved ${supporters.length} supporters for field analysis\n`);
    
    if (supporters.length > 0) {
      console.log('📋 Available fields in first supporter:');
      const firstSupporter = supporters[0];
      
      // Sort fields alphabetically for easier reading
      const fields = Object.keys(firstSupporter).sort();
      fields.forEach((field, index) => {
        const value = firstSupporter[field];
        const type = typeof value;
        const displayValue = type === 'string' && value.length > 50 
          ? value.substring(0, 50) + '...' 
          : value;
        
        console.log(`  ${(index + 1).toString().padStart(2, ' ')}. ${field.padEnd(25, ' ')} (${type.padEnd(8, ' ')}): ${displayValue}`);
      });
      
      console.log('\n🔍 Email/consent related fields:');
      const emailFields = fields.filter(field => 
        field.toLowerCase().includes('email') || 
        field.toLowerCase().includes('opt') || 
        field.toLowerCase().includes('consent') ||
        field.toLowerCase().includes('marketing') ||
        field.toLowerCase().includes('communication')
      );
      
      if (emailFields.length > 0) {
        emailFields.forEach(field => {
          console.log(`  ✅ ${field}: ${firstSupporter[field]}`);
        });
      } else {
        console.log('  ❌ No obvious email consent fields found');
      }
      
      // Check all supporters for email_opt_in patterns
      console.log('\n📈 Email opt-in analysis across all supporters:');
      const optInStats = {};
      
      supporters.forEach(supporter => {
        // Check various possible opt-in field names
        const possibleOptInFields = [
          'email_opt_in',
          'email_marketing_opt_in', 
          'marketing_opt_in',
          'opt_in',
          'email_consent',
          'communication_opt_in'
        ];
        
        possibleOptInFields.forEach(field => {
          if (supporter.hasOwnProperty(field)) {
            const value = supporter[field];
            const key = `${field}: ${value}`;
            optInStats[key] = (optInStats[key] || 0) + 1;
          }
        });
      });
      
      if (Object.keys(optInStats).length > 0) {
        Object.entries(optInStats).forEach(([key, count]) => {
          console.log(`  ${key} - ${count} supporters`);
        });
      } else {
        console.log('  ❌ No opt-in fields found in any supporter');
      }
      
      // Sample supporter data for manual inspection
      console.log('\n🔍 Sample supporter for manual inspection:');
      console.log(JSON.stringify(firstSupporter, null, 2));
    }
    
    await database.close();
    
  } catch (error) {
    logger.error('Field check failed', { error: error.message });
    console.error('❌ Error:', error.message);
  }
}

checkSupporterFields();