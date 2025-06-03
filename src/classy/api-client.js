const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Clean, unified Classy API client with proper server-side filtering
 * and consistent pagination patterns.
 */
class ClassyAPIClient {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseURL = config.baseURL || 'https://api.classy.org';
    this.accessToken = null;
    this.tokenExpiry = null;
    
    this.axios = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ClassySync/2.0'
      }
    });
  }

  /**
   * Authenticate with Classy API using OAuth2 client credentials flow
   */
  async authenticate() {
    try {
      const response = await this.axios.post('/oauth2/auth', {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      
      // Set default authorization header
      this.axios.defaults.headers.common.Authorization = `Bearer ${this.accessToken}`;
      
      logger.info('Successfully authenticated with Classy API');
      return true;
    } catch (error) {
      logger.error('Failed to authenticate with Classy API:', error.message);
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Ensure we have a valid access token
   */
  async ensureAuthenticated() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry - 60000) {
      await this.authenticate();
    }
  }

  /**
   * Make a raw API request with automatic authentication and error handling
   */
  async makeRequest(method, endpoint, data = null, params = {}) {
    await this.ensureAuthenticated();

    try {
      const config = {
        method,
        url: endpoint,
        params,
        data
      };

      const response = await this.axios(config);
      return response.data;
    } catch (error) {
      logger.error(`API request failed: ${method} ${endpoint}`, {
        status: error.response?.status,
        message: error.message,
        data: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Fetch all pages of data with server-side filtering
   */
  async fetchAllPages(endpoint, baseParams = {}, filter = null) {
    const params = { ...baseParams, per_page: 100 };
    if (filter) {
      params.filter = filter;
    }

    let page = 1;
    let allResults = [];
    let hasMorePages = true;

    while (hasMorePages) {
      params.page = page;
      
      const response = await this.makeRequest('GET', endpoint, null, params);
      
      if (response.data && response.data.length > 0) {
        allResults.push(...response.data);
        hasMorePages = page < response.last_page;
        page++;
      } else {
        hasMorePages = false;
      }
    }

    return allResults;
  }

  /**
   * Build a date filter for server-side filtering
   */
  static buildDateFilter(field, operator, date) {
    // Use simple YYYY-MM-DD format for reliable filtering
    const dateString = date.toISOString().split('T')[0];
    return `${field}${operator}${encodeURIComponent(dateString)}`;
  }

  /**
   * Get supporters for an organization with optional filtering
   */
  async getSupporters(organizationId, options = {}) {
    const { updatedSince, limit } = options;
    const endpoint = `/2.0/organizations/${organizationId}/supporters`;
    
    const baseParams = {
      sort: 'updated_at:desc'
    };

    let filter = null;
    if (updatedSince) {
      filter = ClassyAPIClient.buildDateFilter('updated_at', '>', updatedSince);
    }

    let supporters = await this.fetchAllPages(endpoint, baseParams, filter);

    // Apply client-side limit if specified
    if (limit && supporters.length > limit) {
      supporters = supporters.slice(0, limit);
    }

    return supporters;
  }

  /**
   * Get transactions for an organization with optional filtering
   */
  async getTransactions(organizationId, options = {}) {
    const { purchasedSince, updatedSince, limit } = options;
    const endpoint = `/2.0/organizations/${organizationId}/transactions`;
    
    const baseParams = {
      with: 'items',
      sort: 'purchased_at:desc'
    };

    let filter = null;
    if (purchasedSince) {
      filter = ClassyAPIClient.buildDateFilter('purchased_at', '>', purchasedSince);
    } else if (updatedSince) {
      filter = ClassyAPIClient.buildDateFilter('updated_at', '>', updatedSince);
    }

    let transactions = await this.fetchAllPages(endpoint, baseParams, filter);

    // Apply client-side limit if specified
    if (limit && transactions.length > limit) {
      transactions = transactions.slice(0, limit);
    }

    return transactions;
  }

  /**
   * Get campaigns for an organization with optional filtering
   */
  async getCampaigns(organizationId, options = {}) {
    const { updatedSince, limit } = options;
    const endpoint = `/2.0/organizations/${organizationId}/campaigns`;
    
    const baseParams = {
      sort: 'updated_at:desc'
    };

    let filter = null;
    if (updatedSince) {
      filter = ClassyAPIClient.buildDateFilter('updated_at', '>', updatedSince);
    }

    let campaigns = await this.fetchAllPages(endpoint, baseParams, filter);

    // Apply client-side limit if specified
    if (limit && campaigns.length > limit) {
      campaigns = campaigns.slice(0, limit);
    }

    return campaigns;
  }

  /**
   * Get recurring donation plans for an organization with optional filtering
   */
  async getRecurringPlans(organizationId, options = {}) {
    const { updatedSince, limit } = options;
    const endpoint = `/2.0/organizations/${organizationId}/recurring-donation-plans`;
    
    const baseParams = {
      sort: 'updated_at:desc'
    };

    let filter = null;
    if (updatedSince) {
      filter = ClassyAPIClient.buildDateFilter('updated_at', '>', updatedSince);
    }

    let plans = await this.fetchAllPages(endpoint, baseParams, filter);

    // Apply client-side limit if specified
    if (limit && plans.length > limit) {
      plans = plans.slice(0, limit);
    }

    return plans;
  }

  /**
   * Get organization details
   */
  async getOrganization(organizationId) {
    const endpoint = `/2.0/organizations/${organizationId}`;
    return this.makeRequest('GET', endpoint);
  }
}

module.exports = ClassyAPIClient;