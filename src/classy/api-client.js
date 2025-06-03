/**
 * Unified Classy API Client
 * 
 * Clean implementation with OAuth2 authentication and validated filtering
 * Based on comprehensive API validation and datetime filtering solution
 */

const axios = require('axios');
const { createLogger } = require('../utils/logger');

const logger = createLogger('classy-api-client');

class ClassyAPIError extends Error {
  constructor(message, statusCode, response) {
    super(message);
    this.name = 'ClassyAPIError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

class ClassyAPIClient {
  constructor() {
    this.baseURL = 'https://api.classy.org/2.0';
    this.accessToken = null;
    this.tokenExpiry = null;
    this.credentials = null;
    
    // Create axios instance with default config
    this.axios = axios.create({
      baseURL: this.baseURL,
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Classy-Sync/2.0'
      }
    });
    
    // Add response interceptor for error handling
    this.axios.interceptors.response.use(
      (response) => response,
      (error) => this.handleAPIError(error)
    );
    
    // Add request interceptor for authentication
    this.axios.interceptors.request.use(
      async (config) => await this.ensureAuthenticated(config)
    );
  }

  /**
   * Set Classy API credentials
   * @param {Object} credentials - Classy credentials from encrypted storage
   * @param {string} credentials.clientId - Classy client ID
   * @param {string} credentials.clientSecret - Classy client secret
   * @param {number} credentials.organizationId - Classy organization ID
   */
  setCredentials(credentials) {
    this.credentials = credentials;
    this.accessToken = null; // Reset token to force re-authentication
    this.tokenExpiry = null;
    
    logger.debug('Credentials set for organization', { 
      organizationId: credentials.organizationId 
    });
  }

  /**
   * Authenticate with Classy API using OAuth2 client credentials flow
   * @returns {Promise<string>} Access token
   */
  async authenticate() {
    if (!this.credentials) {
      throw new ClassyAPIError('No credentials set. Call setCredentials() first.');
    }

    try {
      logger.debug('Authenticating with Classy API');
      
      const authData = {
        grant_type: 'client_credentials',
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret
      };

      const response = await axios.post('https://api.classy.org/oauth2/auth', authData, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const { access_token, expires_in } = response.data;
      
      this.accessToken = access_token;
      this.tokenExpiry = new Date(Date.now() + (expires_in * 1000));
      
      logger.info('Authentication successful', {
        organizationId: this.credentials.organizationId,
        expiresAt: this.tokenExpiry.toISOString()
      });
      
      return access_token;
      
    } catch (error) {
      logger.error('Authentication failed', {
        organizationId: this.credentials?.organizationId,
        error: error.message
      });
      
      if (error.response?.status === 401) {
        throw new ClassyAPIError(
          'Authentication failed. Check your Classy API credentials.',
          401,
          error.response
        );
      }
      
      throw new ClassyAPIError(
        `Authentication error: ${error.message}`,
        error.response?.status,
        error.response
      );
    }
  }

  /**
   * Ensure we have a valid access token
   * @param {Object} config - Axios request config
   * @returns {Promise<Object>} Updated config with authorization header
   */
  async ensureAuthenticated(config) {
    // Skip auth for auth endpoint itself
    if (config.url?.includes('/oauth2/auth')) {
      return config;
    }

    // Check if token exists and is not expired
    const now = new Date();
    const needsAuth = !this.accessToken || 
                     !this.tokenExpiry || 
                     now >= this.tokenExpiry;

    if (needsAuth) {
      await this.authenticate();
    }

    // Add authorization header
    config.headers.Authorization = `Bearer ${this.accessToken}`;
    
    return config;
  }

  /**
   * Handle API errors with structured logging
   * @param {Error} error - Axios error
   * @throws {ClassyAPIError} Structured API error
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
      // Token expired, reset auth state
      this.accessToken = null;
      this.tokenExpiry = null;
      
      throw new ClassyAPIError(
        'Authentication expired. Token will be refreshed on next request.',
        401,
        error.response
      );
    }
    
    if (status === 403) {
      throw new ClassyAPIError(
        'Access forbidden. Check organization permissions.',
        403,
        error.response
      );
    }
    
    if (status === 429) {
      throw new ClassyAPIError(
        'Rate limit exceeded. Please wait before retrying.',
        429,
        error.response
      );
    }
    
    if (status >= 500) {
      throw new ClassyAPIError(
        'Classy API server error. Please try again later.',
        status,
        error.response
      );
    }

    // Generic error
    throw new ClassyAPIError(
      `API request failed: ${error.message}`,
      status,
      error.response
    );
  }

  /**
   * Build date filter with validated datetime precision
   * VALIDATED: Full datetime precision available with proper encoding
   * @param {string} field - Field name (e.g., 'updated_at', 'purchased_at')
   * @param {string} operator - Operator (>, >=, <, <=, =)
   * @param {Date} date - Date object
   * @returns {string} Properly formatted filter string
   */
  static buildDateFilter(field, operator, date) {
    // For incremental sync, try simpler date format without milliseconds
    // Some APIs have issues with milliseconds in datetime filters
    const isoString = date.toISOString();
    const simplifiedDate = isoString.replace(/\.\d{3}Z$/, '+0000');
    return `${field}${operator}${simplifiedDate}`;  // Let axios handle encoding
  }

  /**
   * Build multiple filters
   * @param {Array} filters - Array of filter objects {field, operator, value}
   * @returns {string} Combined filter string
   */
  static buildFilters(filters) {
    return filters.map(filter => {
      if (filter.value instanceof Date) {
        return ClassyAPIClient.buildDateFilter(filter.field, filter.operator, filter.value);
      }
      return `${filter.field}${filter.operator}${filter.value}`;
    }).join(',');
  }

  /**
   * Fetch a single page from API
   * @param {string} endpoint - API endpoint path
   * @param {number} page - Page number to fetch
   * @param {Object} baseParams - Base query parameters
   * @returns {Promise<Object>} Page data with metadata
   */
  async fetchSinglePage(endpoint, page, baseParams = {}) {
    const params = {
      ...baseParams,
      page,
      per_page: 100 // VALIDATED: Maximum allowed per page
    };

    logger.apiRequest('GET', endpoint, { page, params });

    const response = await this.axios.get(endpoint, { params });
    const data = response.data;

    logger.apiResponse('GET', endpoint, response.status, {
      page,
      recordsOnPage: data.data?.length || 0,
      totalPages: data.last_page,
      totalRecords: data.total
    });

    return {
      data: data.data || [],
      page: data.current_page || page,
      totalPages: data.last_page || 0,
      total: data.total || 0,
      hasMore: page < (data.last_page || 0)
    };
  }

  /**
   * Fetch all pages with server-side filtering (VALIDATED approach)
   * @param {string} endpoint - API endpoint path
   * @param {Object} baseParams - Base query parameters
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} All records from all pages
   */
  async fetchAllPages(endpoint, baseParams = {}, options = {}) {
    const { maxPages = 1000, maxRecords = 100000 } = options;
    let allRecords = [];
    let page = 1;
    let hasMore = true;

    logger.debug('Starting paginated fetch', { endpoint, baseParams, maxPages, maxRecords });

    while (hasMore && page <= maxPages && allRecords.length < maxRecords) {
      const params = {
        ...baseParams,
        page,
        per_page: 100 // VALIDATED: Maximum allowed per page
      };

      logger.apiRequest('GET', endpoint, { page, params });

      const response = await this.axios.get(endpoint, { params });
      const data = response.data;

      logger.apiResponse('GET', endpoint, response.status, {
        page,
        recordsOnPage: data.data?.length || 0,
        totalPages: data.last_page,
        totalRecords: data.total
      });

      // Add records from this page
      if (data.data && Array.isArray(data.data)) {
        allRecords = allRecords.concat(data.data);
      }

      // CRITICAL VALIDATION: Check if we're getting expected data
      if (page === 1 && data.total > 100) {
        logger.warn('Large dataset detected - will fetch all pages', {
          endpoint,
          totalRecords: data.total,
          totalPages: data.last_page,
          currentLimit: maxRecords
        });
      }

      // Check if there are more pages
      hasMore = page < (data.last_page || 0);
      page++;

      // Rate limiting: small delay between requests
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Final validation: Check if we got all expected records
    const lastResponse = await this.axios.get(endpoint, { 
      params: { ...baseParams, page: 1, per_page: 1 } 
    });
    const expectedTotal = lastResponse.data.total;
    
    const recordsReceived = allRecords.length;
    const pagesProcessed = page - 1;
    
    logger.info('Paginated fetch completed', {
      endpoint,
      recordsReceived,
      expectedTotal,
      pagesProcessed,
      dataComplete: recordsReceived === expectedTotal
    });
    
    // Warning if data is incomplete
    if (recordsReceived < expectedTotal) {
      logger.error('INCOMPLETE DATA SYNC', {
        endpoint,
        recordsReceived,
        expectedTotal,
        missingRecords: expectedTotal - recordsReceived,
        reason: recordsReceived >= maxRecords ? 'Hit maxRecords limit' : 'Unknown pagination issue'
      });
    }

    return allRecords;
  }

  /**
   * Get supporters with server-side filtering
   * @param {number} orgId - Classy organization ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Supporter records
   */
  async getSupporters(orgId, options = {}) {
    const { updatedSince, limit, filters = [] } = options;
    const endpoint = `/organizations/${orgId}/supporters`;
    
    const params = {};
    
    // Add date filter if specified
    if (updatedSince) {
      const dateFilter = ClassyAPIClient.buildDateFilter('updated_at', '>', updatedSince);
      filters.push(dateFilter);
    }
    
    // Add filters if any
    if (filters.length > 0) {
      params.filter = filters.join(',');
    }

    logger.sync('supporters', { organizationId: orgId, updatedSince, filterCount: filters.length });
    
    return await this.fetchAllPages(endpoint, params, { maxRecords: limit });
  }

  /**
   * Get transactions with server-side filtering  
   * @param {number} orgId - Classy organization ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Transaction records
   */
  async getTransactions(orgId, options = {}) {
    const { purchasedSince, updatedSince, limit, filters = [] } = options;
    const endpoint = `/organizations/${orgId}/transactions`;
    
    const params = {};
    
    // Add date filters if specified
    if (purchasedSince) {
      const dateFilter = ClassyAPIClient.buildDateFilter('purchased_at', '>', purchasedSince);
      filters.push(dateFilter);
    }
    
    if (updatedSince) {
      const dateFilter = ClassyAPIClient.buildDateFilter('updated_at', '>', updatedSince);
      filters.push(dateFilter);
    }
    
    // Add filters if any
    if (filters.length > 0) {
      params.filter = filters.join(',');
    }

    logger.sync('transactions', { organizationId: orgId, purchasedSince, updatedSince, filterCount: filters.length });
    
    return await this.fetchAllPages(endpoint, params, { maxRecords: limit });
  }

  /**
   * Get campaigns with server-side filtering
   * @param {number} orgId - Classy organization ID  
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Campaign records
   */
  async getCampaigns(orgId, options = {}) {
    const { updatedSince, limit, filters = [] } = options;
    const endpoint = `/organizations/${orgId}/campaigns`;
    
    const params = {};
    
    // Add date filter if specified
    if (updatedSince) {
      const dateFilter = ClassyAPIClient.buildDateFilter('updated_at', '>', updatedSince);
      filters.push(dateFilter);
    }
    
    // Add filters if any
    if (filters.length > 0) {
      params.filter = filters.join(',');
    }

    logger.sync('campaigns', { organizationId: orgId, updatedSince, filterCount: filters.length });
    
    return await this.fetchAllPages(endpoint, params, { maxRecords: limit });
  }

  /**
   * Get recurring donation plans with server-side filtering
   * @param {number} orgId - Classy organization ID
   * @param {Object} options - Query options  
   * @returns {Promise<Array>} Recurring plan records
   */
  async getRecurringPlans(orgId, options = {}) {
    const { updatedSince, limit, filters = [] } = options;
    const endpoint = `/organizations/${orgId}/recurring-donation-plans`;
    
    const params = {};
    
    // Add date filter if specified
    if (updatedSince) {
      const dateFilter = ClassyAPIClient.buildDateFilter('updated_at', '>', updatedSince);
      filters.push(dateFilter);
    }
    
    // Add filters if any  
    if (filters.length > 0) {
      params.filter = filters.join(',');
    }

    logger.sync('recurring-plans', { organizationId: orgId, updatedSince, filterCount: filters.length });
    
    return await this.fetchAllPages(endpoint, params, { maxRecords: limit });
  }

  /**
   * Health check - test API connectivity and authentication
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    try {
      if (!this.credentials) {
        return {
          status: 'error',
          message: 'No credentials configured'
        };
      }

      // Test authentication
      await this.authenticate();
      
      // Test basic API call
      const response = await this.axios.get(`/organizations/${this.credentials.organizationId}`);
      
      return {
        status: 'healthy',
        organizationId: this.credentials.organizationId,
        organizationName: response.data.name,
        authenticated: true,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        organizationId: this.credentials?.organizationId,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = {
  ClassyAPIClient,
  ClassyAPIError
};