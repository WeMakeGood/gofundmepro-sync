const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class MailChimpClient {
  constructor(apiKey, listId) {
    this.apiKey = apiKey;
    this.listId = listId;
    
    if (!this.apiKey) {
      throw new Error('MailChimp API key is required');
    }
    
    // Extract datacenter from API key (format: key-dc)
    const dc = this.apiKey.split('-')[1];
    if (!dc) {
      throw new Error('Invalid MailChimp API key format - should contain datacenter');
    }
    
    this.baseURL = `https://${dc}.api.mailchimp.com/3.0`;
    
    this.client = axios.create({
      baseURL: this.baseURL,
      auth: {
        username: 'anystring',
        password: this.apiKey
      },
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Add request/response logging
    this.client.interceptors.request.use(request => {
      logger.debug('MailChimp API request', {
        method: request.method?.toUpperCase(),
        url: request.url,
        listId: this.listId
      });
      return request;
    });

    this.client.interceptors.response.use(
      response => {
        logger.debug('MailChimp API response', {
          status: response.status,
          url: response.config.url,
          dataLength: JSON.stringify(response.data).length
        });
        return response;
      },
      error => {
        logger.error('MailChimp API error', {
          status: error.response?.status,
          url: error.config?.url,
          error: error.response?.data || error.message
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get member hash for MailChimp API calls
   */
  getMemberHash(email) {
    return crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
  }

  /**
   * Get account information
   */
  async getAccountInfo() {
    const response = await this.client.get('/');
    return response.data;
  }

  /**
   * Get all lists in account
   */
  async getLists() {
    const response = await this.client.get('/lists');
    return response.data.lists;
  }

  /**
   * Get list information
   */
  async getListInfo(listId = null) {
    const targetListId = listId || this.listId;
    const response = await this.client.get(`/lists/${targetListId}`);
    return response.data;
  }

  /**
   * Get merge fields for a list
   */
  async getMergeFields(listId = null) {
    const targetListId = listId || this.listId;
    const response = await this.client.get(`/lists/${targetListId}/merge-fields`);
    return response.data.merge_fields;
  }

  /**
   * Create a new merge field
   */
  async createMergeField(field, listId = null) {
    const targetListId = listId || this.listId;
    const response = await this.client.post(`/lists/${targetListId}/merge-fields`, field);
    return response.data;
  }

  /**
   * Get member by email
   */
  async getMember(email, listId = null) {
    const targetListId = listId || this.listId;
    const memberHash = this.getMemberHash(email);
    
    try {
      const response = await this.client.get(`/lists/${targetListId}/members/${memberHash}`);
      return {
        exists: true,
        member: response.data
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return { exists: false };
      }
      throw error;
    }
  }

  /**
   * Create or update a member
   */
  async upsertMember(memberData, listId = null) {
    const targetListId = listId || this.listId;
    const memberHash = this.getMemberHash(memberData.email_address);
    
    const payload = {
      email_address: memberData.email_address,
      status_if_new: memberData.status || 'subscribed',
      merge_fields: memberData.merge_fields || {},
      tags: memberData.tags || []
    };

    if (memberData.status) {
      payload.status = memberData.status;
    }

    const response = await this.client.put(
      `/lists/${targetListId}/members/${memberHash}`,
      payload
    );
    
    return response.data;
  }

  /**
   * Add or update member tags
   */
  async updateMemberTags(email, tags, listId = null) {
    const targetListId = listId || this.listId;
    const memberHash = this.getMemberHash(email);
    
    const tagData = tags.map(tag => ({
      name: tag,
      status: 'active'
    }));

    const response = await this.client.post(
      `/lists/${targetListId}/members/${memberHash}/tags`,
      { tags: tagData }
    );
    
    return response.status === 204; // MailChimp returns 204 for successful tag updates
  }

  /**
   * Remove member tags
   */
  async removeMemberTags(email, tags, listId = null) {
    const targetListId = listId || this.listId;
    const memberHash = this.getMemberHash(email);
    
    const tagData = tags.map(tag => ({
      name: tag,
      status: 'inactive'
    }));

    const response = await this.client.post(
      `/lists/${targetListId}/members/${memberHash}/tags`,
      { tags: tagData }
    );
    
    return response.status === 204;
  }

  /**
   * Get all tags for the list
   */
  async getTags(listId = null) {
    const targetListId = listId || this.listId;
    
    try {
      const response = await this.client.get(`/lists/${targetListId}/tag-search`);
      return response.data.tags || [];
    } catch (error) {
      logger.warn('Could not fetch tags', { error: error.message });
      return [];
    }
  }

  /**
   * Get segments for the list
   */
  async getSegments(listId = null) {
    const targetListId = listId || this.listId;
    const response = await this.client.get(`/lists/${targetListId}/segments`);
    return response.data.segments;
  }

  /**
   * Batch subscribe/update members
   */
  async batchUpsertMembers(members, listId = null) {
    const targetListId = listId || this.listId;
    
    const operations = members.map(member => ({
      method: 'PUT',
      path: `/lists/${targetListId}/members/${this.getMemberHash(member.email_address)}`,
      body: JSON.stringify({
        email_address: member.email_address,
        status_if_new: member.status || 'subscribed',
        merge_fields: member.merge_fields || {},
        tags: member.tags || []
      })
    }));

    const response = await this.client.post('/batches', {
      operations
    });
    
    return response.data;
  }

  /**
   * Get batch operation status
   */
  async getBatchStatus(batchId) {
    const response = await this.client.get(`/batches/${batchId}`);
    return response.data;
  }

  /**
   * Validate list access and get basic info
   */
  async validateAccess() {
    try {
      const [accountInfo, listInfo] = await Promise.all([
        this.getAccountInfo(),
        this.getListInfo()
      ]);

      return {
        valid: true,
        account: {
          name: accountInfo.account_name,
          email: accountInfo.email,
          id: accountInfo.account_id
        },
        list: {
          name: listInfo.name,
          memberCount: listInfo.stats.member_count,
          id: listInfo.id
        }
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }
}

module.exports = MailChimpClient;