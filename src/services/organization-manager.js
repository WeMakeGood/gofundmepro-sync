/**
 * Organization Management Service
 * 
 * Manages organizations and their encrypted Classy API credentials
 * Provides secure storage and retrieval of sensitive credentials
 */

const { getKnex } = require('../config/database');
const { encryptClassyCredentials, decryptClassyCredentials, EncryptionError } = require('../utils/encryption-simple');
const { createLogger } = require('../utils/logger');

const logger = createLogger('organization-manager');

class OrganizationManager {
  constructor() {
    this.tableName = 'organizations';
  }

  /**
   * Get database instance
   * @returns {Object} Knex instance
   */
  getDb() {
    return getKnex();
  }

  /**
   * Create a new organization with encrypted credentials
   * @param {Object} organizationData - Organization information
   * @param {string} organizationData.name - Organization name
   * @param {number} organizationData.classyId - Classy organization ID
   * @param {Object} organizationData.credentials - Classy API credentials
   * @param {string} organizationData.credentials.clientId - Classy client ID
   * @param {string} organizationData.credentials.clientSecret - Classy client secret
   * @returns {Promise<Object>} Created organization record
   */
  async createOrganization(organizationData) {
    const { name, classyId, credentials } = organizationData;
    
    try {
      logger.info('Creating new organization', { name, classyId });
      
      // Validate required fields
      if (!name || !classyId || !credentials) {
        throw new Error('Missing required fields: name, classyId, credentials');
      }
      
      // Check if organization already exists
      const existing = await this.getDb()(this.tableName)
        .where('classy_id', classyId)
        .first();
        
      if (existing) {
        throw new Error(`Organization with Classy ID ${classyId} already exists`);
      }
      
      // Encrypt credentials
      const encryptedCredentials = encryptClassyCredentials({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        organizationId: classyId // Store the Classy org ID in credentials too
      });
      
      // Insert organization
      const [organizationId] = await this.getDb()(this.tableName)
        .insert({
          classy_id: classyId,
          name: name,
          status: 'active',
          encrypted_credentials: encryptedCredentials,
          created_at: new Date(),
          updated_at: new Date()
        });
        
      logger.info('Organization created successfully', { 
        organizationId, 
        name, 
        classyId 
      });
      
      return await this.getOrganization(organizationId);
      
    } catch (error) {
      logger.error('Failed to create organization', error);
      throw error;
    }
  }

  /**
   * Get organization by internal ID
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<Object>} Organization record (without decrypted credentials)
   */
  async getOrganization(organizationId) {
    try {
      const organization = await this.getDb()(this.tableName)
        .where('id', organizationId)
        .first();
        
      if (!organization) {
        throw new Error(`Organization with ID ${organizationId} not found`);
      }
      
      // Return organization without encrypted credentials
      const { encrypted_credentials, ...publicData } = organization;
      return publicData;
      
    } catch (error) {
      logger.error('Failed to get organization', error);
      throw error;
    }
  }

  /**
   * Get organization by Classy ID
   * @param {number} classyId - Classy organization ID
   * @returns {Promise<Object>} Organization record (without decrypted credentials)
   */
  async getOrganizationByClassyId(classyId) {
    try {
      const organization = await this.getDb()(this.tableName)
        .where('classy_id', classyId)
        .first();
        
      if (!organization) {
        throw new Error(`Organization with Classy ID ${classyId} not found`);
      }
      
      // Return organization without encrypted credentials
      const { encrypted_credentials, ...publicData } = organization;
      return publicData;
      
    } catch (error) {
      logger.error('Failed to get organization by Classy ID', error);
      throw error;
    }
  }

  /**
   * Get decrypted Classy credentials for an organization
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<Object>} Decrypted Classy credentials
   */
  async getClassyCredentials(organizationId) {
    try {
      logger.debug('Retrieving Classy credentials', { organizationId });
      
      const organization = await this.getDb()(this.tableName)
        .where('id', organizationId)
        .first();
        
      if (!organization) {
        throw new Error(`Organization with ID ${organizationId} not found`);
      }
      
      if (!organization.encrypted_credentials) {
        throw new Error(`No credentials found for organization ${organizationId}`);
      }
      
      // Decrypt credentials
      const credentials = decryptClassyCredentials(organization.encrypted_credentials);
      
      logger.debug('Credentials retrieved successfully', { 
        organizationId,
        hasClientId: !!credentials.clientId,
        hasClientSecret: !!credentials.clientSecret
      });
      
      return credentials;
      
    } catch (error) {
      if (error instanceof EncryptionError) {
        logger.error('Failed to decrypt credentials', { organizationId, error: error.message });
        throw new Error('Credentials decryption failed. Encryption key may have changed.');
      }
      
      logger.error('Failed to get Classy credentials', error);
      throw error;
    }
  }

  /**
   * Update organization credentials
   * @param {number} organizationId - Internal organization ID
   * @param {Object} credentials - New Classy API credentials
   * @returns {Promise<Object>} Updated organization record
   */
  async updateCredentials(organizationId, credentials) {
    try {
      logger.info('Updating organization credentials', { organizationId });
      
      const organization = await this.getOrganization(organizationId);
      
      // Encrypt new credentials
      const encryptedCredentials = encryptClassyCredentials({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        organizationId: organization.classy_id
      });
      
      // Update organization
      await this.getDb()(this.tableName)
        .where('id', organizationId)
        .update({
          encrypted_credentials: encryptedCredentials,
          updated_at: new Date()
        });
        
      logger.info('Credentials updated successfully', { organizationId });
      
      return await this.getOrganization(organizationId);
      
    } catch (error) {
      logger.error('Failed to update credentials', error);
      throw error;
    }
  }

  /**
   * List all organizations
   * @returns {Promise<Array>} Array of organization records (without credentials)
   */
  async listOrganizations() {
    try {
      const organizations = await this.getDb()(this.tableName)
        .select('id', 'classy_id', 'name', 'status', 'created_at', 'updated_at')
        .orderBy('created_at', 'desc');
        
      logger.debug('Listed organizations', { count: organizations.length });
      
      return organizations;
      
    } catch (error) {
      logger.error('Failed to list organizations', error);
      throw error;
    }
  }

  /**
   * Update organization status
   * @param {number} organizationId - Internal organization ID
   * @param {string} status - New status (active, inactive)
   * @returns {Promise<Object>} Updated organization record
   */
  async updateStatus(organizationId, status) {
    try {
      logger.info('Updating organization status', { organizationId, status });
      
      if (!['active', 'inactive'].includes(status)) {
        throw new Error('Status must be either "active" or "inactive"');
      }
      
      await this.getDb()(this.tableName)
        .where('id', organizationId)
        .update({
          status: status,
          updated_at: new Date()
        });
        
      logger.info('Status updated successfully', { organizationId, status });
      
      return await this.getOrganization(organizationId);
      
    } catch (error) {
      logger.error('Failed to update status', error);
      throw error;
    }
  }

  /**
   * Delete organization (soft delete by setting status to inactive)
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<Object>} Updated organization record
   */
  async deleteOrganization(organizationId) {
    try {
      logger.info('Deleting organization', { organizationId });
      
      const result = await this.updateStatus(organizationId, 'inactive');
      
      logger.info('Organization deleted (deactivated)', { organizationId });
      
      return result;
      
    } catch (error) {
      logger.error('Failed to delete organization', error);
      throw error;
    }
  }

  /**
   * Test credentials by attempting to decrypt them
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<boolean>} True if credentials are valid
   */
  async testCredentials(organizationId) {
    try {
      const credentials = await this.getClassyCredentials(organizationId);
      
      // Basic validation
      const isValid = !!(
        credentials.clientId && 
        credentials.clientSecret && 
        credentials.organizationId
      );
      
      logger.debug('Credentials test result', { organizationId, isValid });
      
      return isValid;
      
    } catch (error) {
      logger.warn('Credentials test failed', { organizationId, error: error.message });
      return false;
    }
  }
}

// Export singleton instance
const organizationManager = new OrganizationManager();

module.exports = {
  OrganizationManager,
  organizationManager
};