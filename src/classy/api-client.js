const axios = require('axios');
const ClassyAuth = require('./auth');
const { RetryManager, CircuitBreaker } = require('../utils/retry');
const logger = require('../utils/logger');

class ClassyPaginator {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async *fetchAllPages(endpoint, params = {}) {
    let nextUrl = endpoint;
    
    while (nextUrl) {
      const response = await this.apiClient.makeRequest('GET', nextUrl, null, params);
      yield response;
      
      nextUrl = response.next_page_url;
      params = {}; // Clear params after first request
    }
  }
  
  async fetchAll(endpoint, params = {}) {
    const results = [];
    for await (const page of this.fetchAllPages(endpoint, params)) {
      if (page.data && Array.isArray(page.data)) {
        results.push(...page.data);
      }
    }
    return results;
  }
}

class ClassyAPIClient {
  constructor(config = {}) {
    this.baseURL = config.baseURL || process.env.CLASSY_API_BASE_URL || 'https://api.classy.org';
    this.clientId = config.clientId || process.env.CLASSY_CLIENT_ID;
    this.clientSecret = config.clientSecret || process.env.CLASSY_CLIENT_SECRET;
    
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Classy API credentials are required');
    }

    this.auth = new ClassyAuth(this.clientId, this.clientSecret, this.baseURL);
    this.retryManager = new RetryManager(config.retry);
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    this.paginator = new ClassyPaginator(this);
    
    // Organization management
    this.organizationIds = [];
    this.organizationsLoaded = false;
    
    // Rate limiting
    this.requestQueue = [];
    this.requestsPerSecond = config.requestsPerSecond || 10;
    this.lastRequestTime = 0;
  }

  async makeRequest(method, endpoint, data = null, params = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseURL}${endpoint}`;
    
    return await this.circuitBreaker.execute(async () => {
      return await this.retryManager.execute(async () => {
        await this.rateLimit();
        
        const token = await this.auth.getToken();
        const startTime = Date.now();
        
        try {
          const config = {
            method,
            url,
            headers: this.auth.getAuthHeaders(),
            timeout: 30000
          };

          if (data) {
            config.data = data;
          }
          
          if (Object.keys(params).length > 0) {
            config.params = params;
          }

          const response = await axios(config);
          
          const duration = Date.now() - startTime;
          logger.apiCall(endpoint, method, response.status, duration, {
            dataLength: response.data ? JSON.stringify(response.data).length : 0
          });
          
          return response.data;
        } catch (error) {
          const duration = Date.now() - startTime;
          const status = error.response?.status || 'ERROR';
          
          logger.apiCall(endpoint, method, status, duration, {
            error: error.message
          });

          // Handle authentication errors
          if (status === 401) {
            logger.warn('Authentication error, refreshing token');
            await this.auth.refreshToken();
            throw error; // Will retry with new token
          }

          throw error;
        }
      });
    }, endpoint);
  }

  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 1000 / this.requestsPerSecond;
    
    if (timeSinceLastRequest < minInterval) {
      const delay = minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  // Organization discovery and management
  async getAvailableOrganizations() {
    return await this.makeRequest('GET', `/2.0/apps/${this.clientId}/organizations`);
  }

  async loadOrganizations() {
    if (this.organizationsLoaded) {
      return this.organizationIds;
    }

    try {
      logger.info('Loading available organizations for client');
      const response = await this.getAvailableOrganizations();
      
      if (response && response.data && Array.isArray(response.data)) {
        this.organizationIds = response.data.map(org => org.id);
        this.organizationsLoaded = true;
        
        logger.info(`Loaded ${this.organizationIds.length} organizations`, {
          organizationIds: this.organizationIds
        });
      } else {
        logger.warn('No organizations found or unexpected response format');
        this.organizationIds = [];
      }
    } catch (error) {
      logger.error('Failed to load organizations:', error.message);
      this.organizationIds = [];
    }

    return this.organizationIds;
  }

  async getOrganizationIds() {
    if (!this.organizationsLoaded) {
      await this.loadOrganizations();
    }
    return this.organizationIds;
  }

  // Helper method to get organization-scoped endpoint
  async getOrgScopedEndpoint(endpoint, organizationId = null) {
    if (organizationId) {
      return `/2.0/organizations/${organizationId}${endpoint}`;
    }

    // Auto-discover organization if not provided
    const orgIds = await this.getOrganizationIds();
    if (orgIds.length === 0) {
      throw new Error('No organizations available for this API client');
    }

    // Use first organization by default
    const defaultOrgId = orgIds[0];
    logger.debug(`Using default organization ${defaultOrgId} for endpoint ${endpoint}`);
    return `/2.0/organizations/${defaultOrgId}${endpoint}`;
  }

  // Supporter methods
  async getSupporter(supporterId, organizationId = null) {
    return await this.makeRequest('GET', `/2.0/supporters/${supporterId}`);
  }

  async getSupporters(params = {}, organizationId = null) {
    const endpoint = await this.getOrgScopedEndpoint('/supporters', organizationId);
    return await this.paginator.fetchAll(endpoint, params);
  }

  // Transaction methods
  async getCampaignTransactions(campaignId, params = {}, organizationId = null) {
    const endpoint = await this.getOrgScopedEndpoint(`/campaigns/${campaignId}/transactions`, organizationId);
    return await this.paginator.fetchAll(endpoint, params);
  }

  async getTransaction(transactionId, organizationId = null) {
    return await this.makeRequest('GET', `/2.0/transactions/${transactionId}`);
  }

  async getTransactions(params = {}, organizationId = null) {
    const endpoint = await this.getOrgScopedEndpoint('/transactions', organizationId);
    return await this.paginator.fetchAll(endpoint, params);
  }

  // Helper method for date-filtered transactions (using purchased_at as per Classy example)
  async getTransactionsSince(sinceDate, params = {}, organizationId = null) {
    const formattedDate = sinceDate.toISOString().replace(/\.\d{3}Z$/, '+0000');
    const filterParams = {
      ...params,
      filter: `purchased_at>${formattedDate}`,
      with: 'items' // Include items as per Classy example
    };
    
    const endpoint = await this.getOrgScopedEndpoint('/transactions', organizationId);
    
    // If per_page is small (<=10), just get first page to avoid fetching everything
    if (filterParams.per_page && filterParams.per_page <= 10) {
      const response = await this.makeRequest('GET', endpoint, null, filterParams);
      return response.data || [];
    } else {
      // For larger requests, use pagination to get all results
      return await this.paginator.fetchAll(endpoint, filterParams);
    }
  }

  // Recurring donation methods
  async getCampaignRecurringPlans(campaignId, params = {}, organizationId = null) {
    const endpoint = await this.getOrgScopedEndpoint(`/campaigns/${campaignId}/recurring-donation-plans`, organizationId);
    return await this.paginator.fetchAll(endpoint, params);
  }

  async getRecurringPlan(planId, organizationId = null) {
    return await this.makeRequest('GET', `/2.0/recurring-donation-plans/${planId}`);
  }

  async getRecurringPlans(params = {}, organizationId = null) {
    const endpoint = await this.getOrgScopedEndpoint('/recurring-donation-plans', organizationId);
    return await this.paginator.fetchAll(endpoint, params);
  }

  // Campaign methods
  async getCampaign(campaignId, organizationId = null) {
    const endpoint = await this.getOrgScopedEndpoint(`/campaigns/${campaignId}`, organizationId);
    return await this.makeRequest('GET', endpoint);
  }

  async getCampaigns(params = {}, organizationId = null) {
    const endpoint = await this.getOrgScopedEndpoint('/campaigns', organizationId);
    return await this.paginator.fetchAll(endpoint, params);
  }

  // Organization methods  
  async getOrganization(organizationId) {
    return await this.makeRequest('GET', `/2.0/organizations/${organizationId}`);
  }

  async getOrganizations() {
    return await this.getAvailableOrganizations();
  }

  // Fundraising team methods
  async getCampaignFundraisingTeams(campaignId, params = {}, organizationId = null) {
    const endpoint = await this.getOrgScopedEndpoint(`/campaigns/${campaignId}/fundraising-teams`, organizationId);
    return await this.paginator.fetchAll(endpoint, params);
  }

  // Fundraising page methods
  async getCampaignFundraisingPages(campaignId, params = {}, organizationId = null) {
    const endpoint = await this.getOrgScopedEndpoint(`/campaigns/${campaignId}/fundraising-pages`, organizationId);
    return await this.paginator.fetchAll(endpoint, params);
  }

  // Health check - test organization discovery and org-scoped endpoints
  async healthCheck() {
    try {
      // First test organization discovery
      const orgs = await this.getAvailableOrganizations();
      
      if (!orgs || !orgs.data || orgs.data.length === 0) {
        return {
          status: 'warning',
          message: 'No organizations available',
          timestamp: new Date().toISOString(),
          circuitBreakerState: this.circuitBreaker.getState()
        };
      }

      // Test org-scoped endpoint
      const orgId = orgs.data[0].id;
      const endpoint = `/2.0/organizations/${orgId}/campaigns`;
      await this.makeRequest('GET', endpoint, null, { per_page: 1 });
      
      return { 
        status: 'ok', 
        organizationCount: orgs.data.length,
        testedEndpoint: endpoint,
        timestamp: new Date().toISOString(),
        circuitBreakerState: this.circuitBreaker.getState()
      };
      
    } catch (error) {
      return { 
        status: 'error', 
        error: error.message,
        timestamp: new Date().toISOString(),
        circuitBreakerState: this.circuitBreaker.getState()
      };
    }
  }
}

module.exports = ClassyAPIClient;