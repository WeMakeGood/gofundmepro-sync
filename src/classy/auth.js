const axios = require('axios');
const logger = require('../utils/logger');

class ClassyAuth {
  constructor(clientId, clientSecret, baseURL = 'https://api.classy.org') {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseURL = baseURL;
    this.token = null;
    this.tokenExpiry = null;
  }

  async getToken() {
    if (this.token && this.tokenExpiry > Date.now()) {
      return this.token;
    }
    
    const startTime = Date.now();
    try {
      const response = await axios.post(`${this.baseURL}/oauth2/auth`, {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret
      });
      
      this.token = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // Refresh 1 min early
      
      const duration = Date.now() - startTime;
      logger.apiCall('/oauth2/auth', 'POST', response.status, duration, {
        tokenType: response.data.token_type,
        expiresIn: response.data.expires_in
      });
      
      return this.token;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.apiCall('/oauth2/auth', 'POST', error.response?.status || 'ERROR', duration, {
        error: error.message
      });
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  async refreshToken() {
    this.token = null;
    this.tokenExpiry = null;
    return await this.getToken();
  }

  isTokenValid() {
    return this.token && this.tokenExpiry > Date.now();
  }

  getAuthHeaders() {
    if (!this.token) {
      throw new Error('No valid token available');
    }
    
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };
  }
}

module.exports = ClassyAuth;