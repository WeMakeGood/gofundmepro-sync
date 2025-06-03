/**
 * MailChimp API Client
 * 
 * Handles all MailChimp API interactions including authentication, 
 * member operations, batch processing, and list management
 */

const axios = require('axios');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');

const logger = createLogger('mailchimp-client');

class MailChimpAPIError extends Error {
  constructor(message, statusCode, response) {
    super(message);
    this.name = 'MailChimpAPIError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

class MailChimpClient {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.listId = config.listId;
    this.batchSize = config.batchSize || 50;
    this.tagPrefix = config.tagPrefix || 'Classy-';
    
    // Extract datacenter from API key
    if (!this.apiKey || !this.apiKey.includes('-')) {
      throw new Error('Invalid MailChimp API key format. Expected format: key-dc');
    }
    
    this.datacenter = this.apiKey.split('-')[1];
    this.baseURL = `https://${this.datacenter}.api.mailchimp.com/3.0`;
    
    // Create axios instance
    this.axios = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Classy-Sync/2.0'
      },
      auth: {
        username: 'anystring',
        password: this.apiKey
      }
    });
    
    // Add response interceptor for error handling
    this.axios.interceptors.response.use(
      (response) => response,
      (error) => this.handleAPIError(error)
    );
    
    logger.debug('MailChimp client initialized', {
      datacenter: this.datacenter,
      listId: this.listId,
      batchSize: this.batchSize
    });
  }

  /**
   * Handle MailChimp API errors
   * @param {Error} error - Axios error
   * @throws {MailChimpAPIError} Structured API error
   */
  handleAPIError(error) {
    const status = error.response?.status;
    const statusText = error.response?.statusText;
    const data = error.response?.data;
    
    logger.apiResponse(
      error.config?.method?.toUpperCase() || 'UNKNOWN',
      error.config?.url || 'unknown',
      status || 0,
      { error: error.message, statusText, data }
    );

    // Handle specific error cases
    if (status === 401) {
      throw new MailChimpAPIError(
        'MailChimp authentication failed. Check your API key.',
        401,
        error.response
      );
    }
    
    if (status === 403) {
      throw new MailChimpAPIError(
        'MailChimp access forbidden. Check API key permissions.',
        403,
        error.response
      );
    }
    
    if (status === 429) {
      throw new MailChimpAPIError(
        'MailChimp rate limit exceeded. Please wait before retrying.',
        429,
        error.response
      );
    }
    
    if (status >= 500) {
      throw new MailChimpAPIError(
        'MailChimp server error. Please try again later.',
        status,
        error.response
      );
    }

    // Generic error
    throw new MailChimpAPIError(
      `MailChimp API request failed: ${data?.detail || error.message}`,
      status,
      error.response
    );
  }

  /**
   * Test MailChimp API connectivity and authentication
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    try {
      // Test basic API connectivity
      const pingResponse = await this.axios.get('/ping');
      
      // Test list access
      const listResponse = await this.axios.get(`/lists/${this.listId}`);
      
      return {
        status: 'healthy',
        apiConnected: true,
        listAccess: true,
        listName: listResponse.data.name,
        memberCount: listResponse.data.stats.member_count,
        datacenter: this.datacenter
      };
      
    } catch (error) {
      return {
        status: 'error',
        apiConnected: false,
        error: error.message,
        datacenter: this.datacenter
      };
    }
  }

  /**
   * Get list information including merge fields and segments
   * @returns {Promise<Object>} List details
   */
  async getListInfo() {
    try {
      const [listInfo, mergeFields] = await Promise.all([
        this.axios.get(`/lists/${this.listId}`),
        this.axios.get(`/lists/${this.listId}/merge-fields`)
      ]);

      return {
        list: listInfo.data,
        mergeFields: mergeFields.data.merge_fields.map(field => ({
          tag: field.tag,
          name: field.name,
          type: field.type,
          required: field.required
        }))
      };
      
    } catch (error) {
      logger.error('Failed to get MailChimp list info', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate MailChimp member hash for email
   * @param {string} email - Email address
   * @returns {string} MD5 hash for MailChimp member ID
   */
  generateMemberHash(email) {
    return crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
  }

  /**
   * Add or update a single member
   * @param {Object} memberData - Member data with email and merge fields
   * @param {Object} options - Update options
   * @returns {Promise<Object>} Member update result
   */
  async upsertMember(memberData, options = {}) {
    const { email, mergeFields = {}, tags = [], interests = {} } = memberData;
    const { skipDoubleOptIn = true } = options;
    
    const memberHash = this.generateMemberHash(email);
    
    const requestData = {
      email_address: email,
      status_if_new: skipDoubleOptIn ? 'subscribed' : 'pending',
      merge_fields: mergeFields,
      interests: interests
    };

    try {
      // Upsert member
      const response = await this.axios.put(
        `/lists/${this.listId}/members/${memberHash}`,
        requestData
      );

      // Update tags if provided
      if (tags.length > 0) {
        await this.updateMemberTags(email, tags);
      }

      logger.debug('Member upserted successfully', {
        email,
        memberId: memberHash,
        status: response.data.status,
        tagCount: tags.length
      });

      return {
        success: true,
        email,
        memberId: memberHash,
        status: response.data.status,
        tagsApplied: tags.length
      };

    } catch (error) {
      logger.error('Failed to upsert MailChimp member', {
        email,
        error: error.message
      });
      
      return {
        success: false,
        email,
        error: error.message
      };
    }
  }

  /**
   * Update member tags
   * @param {string} email - Member email
   * @param {Array<string>} tags - Tags to apply
   * @returns {Promise<Object>} Tag update result
   */
  async updateMemberTags(email, tags) {
    const memberHash = this.generateMemberHash(email);
    
    // Convert tags to MailChimp format
    const tagOperations = tags.map(tag => ({
      name: tag,
      status: 'active'
    }));

    try {
      const response = await this.axios.post(
        `/lists/${this.listId}/members/${memberHash}/tags`,
        { tags: tagOperations }
      );

      logger.debug('Member tags updated', {
        email,
        tags: tags.length
      });

      return {
        success: true,
        tagsApplied: tags.length
      };

    } catch (error) {
      logger.error('Failed to update member tags', {
        email,
        tags,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Process members in batches for bulk operations
   * @param {Array<Object>} members - Array of member data
   * @param {Object} options - Batch processing options
   * @returns {Promise<Object>} Batch processing results
   */
  async batchUpsertMembers(members, options = {}) {
    const { waitForCompletion = false } = options;
    
    if (members.length === 0) {
      return { success: true, processed: 0, errors: 0 };
    }

    logger.info(`Starting batch upsert of ${members.length} members`);

    // Process in batches
    const batches = [];
    for (let i = 0; i < members.length; i += this.batchSize) {
      batches.push(members.slice(i, i + this.batchSize));
    }

    let totalProcessed = 0;
    let totalErrors = 0;
    const batchResults = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchNumber = batchIndex + 1;
      
      logger.info(`Processing batch ${batchNumber}/${batches.length}`, {
        batchSize: batch.length
      });

      try {
        // Convert to MailChimp batch format
        const operations = batch.map((member, index) => {
          const memberHash = this.generateMemberHash(member.email);
          
          return {
            method: 'PUT',
            path: `/lists/${this.listId}/members/${memberHash}`,
            operation_id: `batch-${batchIndex}-${index}`,
            body: JSON.stringify({
              email_address: member.email,
              status_if_new: 'subscribed',
              merge_fields: member.mergeFields || {},
              interests: member.interests || {}
            })
          };
        });

        // Submit batch
        const batchResponse = await this.axios.post('/batches', {
          operations
        });

        const batchId = batchResponse.data.id;
        
        logger.info(`Batch ${batchNumber} submitted`, {
          batchId,
          operations: operations.length
        });

        // Handle tags separately (not supported in batch operations)
        for (const member of batch) {
          if (member.tags && member.tags.length > 0) {
            try {
              await this.updateMemberTags(member.email, member.tags);
            } catch (error) {
              logger.warn('Failed to update tags for member', {
                email: member.email,
                error: error.message
              });
            }
          }
        }

        totalProcessed += batch.length;
        batchResults.push({
          batchId,
          batchNumber,
          memberCount: batch.length,
          status: 'submitted'
        });

        // Wait for batch completion if requested
        if (waitForCompletion) {
          await this.waitForBatchCompletion(batchId);
        }

        // Rate limiting between batches
        if (batchIndex < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        logger.error(`Batch ${batchNumber} failed`, {
          error: error.message,
          batchSize: batch.length
        });
        
        totalErrors += batch.length;
        batchResults.push({
          batchNumber,
          memberCount: batch.length,
          status: 'failed',
          error: error.message
        });
      }
    }

    logger.info('Batch processing completed', {
      totalMembers: members.length,
      totalProcessed,
      totalErrors,
      batches: batches.length
    });

    return {
      success: totalErrors === 0,
      totalMembers: members.length,
      processed: totalProcessed,
      errors: totalErrors,
      batches: batchResults
    };
  }

  /**
   * Wait for batch operation to complete
   * @param {string} batchId - MailChimp batch ID
   * @returns {Promise<Object>} Batch completion status
   */
  async waitForBatchCompletion(batchId) {
    const maxWaitTime = 300000; // 5 minutes
    const pollInterval = 5000; // 5 seconds
    const startTime = Date.now();

    logger.info(`Waiting for batch completion`, { batchId });

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const response = await this.axios.get(`/batches/${batchId}`);
        const status = response.data.status;
        
        if (status === 'finished') {
          logger.info(`Batch completed successfully`, {
            batchId,
            totalOperations: response.data.total_operations,
            finishedOperations: response.data.finished_operations,
            erroredOperations: response.data.errored_operations
          });
          
          return response.data;
        }
        
        if (status === 'error') {
          throw new Error(`Batch processing failed: ${response.data.status}`);
        }
        
        logger.debug(`Batch still processing`, {
          batchId,
          status,
          progress: `${response.data.finished_operations}/${response.data.total_operations}`
        });
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
      } catch (error) {
        logger.error(`Error checking batch status`, {
          batchId,
          error: error.message
        });
        throw error;
      }
    }
    
    throw new Error(`Batch processing timeout after ${maxWaitTime/1000} seconds`);
  }

  /**
   * Get member information
   * @param {string} email - Member email
   * @returns {Promise<Object>} Member data
   */
  async getMember(email) {
    const memberHash = this.generateMemberHash(email);
    
    try {
      const response = await this.axios.get(
        `/lists/${this.listId}/members/${memberHash}`
      );
      
      return response.data;
      
    } catch (error) {
      if (error.statusCode === 404) {
        return null; // Member not found
      }
      throw error;
    }
  }

  /**
   * Delete a member from the list
   * @param {string} email - Member email
   * @returns {Promise<boolean>} Success status
   */
  async deleteMember(email) {
    const memberHash = this.generateMemberHash(email);
    
    try {
      await this.axios.delete(`/lists/${this.listId}/members/${memberHash}`);
      
      logger.info('Member deleted successfully', { email });
      return true;
      
    } catch (error) {
      if (error.statusCode === 404) {
        logger.warn('Member not found for deletion', { email });
        return true; // Already doesn't exist
      }
      
      logger.error('Failed to delete member', {
        email,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Archive a member (soft delete)
   * @param {string} email - Member email
   * @returns {Promise<boolean>} Success status
   */
  async archiveMember(email) {
    const memberHash = this.generateMemberHash(email);
    
    try {
      await this.axios.patch(`/lists/${this.listId}/members/${memberHash}`, {
        status: 'archived'
      });
      
      logger.info('Member archived successfully', { email });
      return true;
      
    } catch (error) {
      logger.error('Failed to archive member', {
        email,
        error: error.message
      });
      return false;
    }
  }
}

module.exports = {
  MailChimpClient,
  MailChimpAPIError
};