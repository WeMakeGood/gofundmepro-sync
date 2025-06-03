/**
 * Encryption Utilities
 * 
 * Secure encryption/decryption for storing Classy API credentials
 * Uses AES-256-GCM for authenticated encryption
 */

const crypto = require('crypto');

class EncryptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EncryptionError';
  }
}

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 16;  // 128 bits
    this.tagLength = 16; // 128 bits
    
    // Get encryption key from environment
    this.encryptionKey = this.getEncryptionKey();
  }

  /**
   * Get encryption key from environment
   * @returns {Buffer} Encryption key buffer
   */
  getEncryptionKey() {
    const keyHex = process.env.ENCRYPTION_KEY;
    
    if (!keyHex) {
      throw new EncryptionError(
        'ENCRYPTION_KEY not found in environment variables. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }
    
    if (keyHex.length !== 64) { // 32 bytes = 64 hex characters
      throw new EncryptionError(
        'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ' +
        'Current length: ' + keyHex.length
      );
    }
    
    try {
      return Buffer.from(keyHex, 'hex');
    } catch (error) {
      throw new EncryptionError('Invalid ENCRYPTION_KEY format. Must be valid hex string.');
    }
  }

  /**
   * Encrypt sensitive data (Classy credentials)
   * @param {Object} data - Data to encrypt
   * @returns {string} Base64 encoded encrypted data with IV and auth tag
   */
  encrypt(data) {
    try {
      // Convert data to JSON string
      const plaintext = JSON.stringify(data);
      
      // Generate random IV
      const iv = crypto.randomBytes(this.ivLength);
      
      // Create cipher
      const cipher = crypto.createCipher(this.algorithm, this.encryptionKey);
      
      // Encrypt data
      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      
      // Get authentication tag
      const tag = cipher.getAuthTag();
      
      // Combine IV + encrypted data + auth tag
      const combined = Buffer.concat([iv, encrypted, tag]);
      
      // Return base64 encoded
      return combined.toString('base64');
      
    } catch (error) {
      throw new EncryptionError(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt sensitive data (Classy credentials)
   * @param {string} encryptedData - Base64 encoded encrypted data
   * @returns {Object} Decrypted data object
   */
  decrypt(encryptedData) {
    try {
      // Decode from base64
      const combined = Buffer.from(encryptedData, 'base64');
      
      // Extract components
      const iv = combined.slice(0, this.ivLength);
      const tag = combined.slice(-this.tagLength);
      const encrypted = combined.slice(this.ivLength, -this.tagLength);
      
      // Create decipher
      const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey);
      decipher.setAuthTag(tag);
      
      // Decrypt data
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      // Parse JSON
      const plaintext = decrypted.toString('utf8');
      return JSON.parse(plaintext);
      
    } catch (error) {
      throw new EncryptionError(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Encrypt Classy API credentials
   * @param {Object} credentials - Classy credentials
   * @param {string} credentials.clientId - Classy client ID
   * @param {string} credentials.clientSecret - Classy client secret
   * @param {number} credentials.organizationId - Classy organization ID
   * @returns {string} Encrypted credentials string
   */
  encryptClassyCredentials(credentials) {
    // Validate required fields
    if (!credentials.clientId || !credentials.clientSecret || !credentials.organizationId) {
      throw new EncryptionError(
        'Missing required Classy credentials: clientId, clientSecret, organizationId'
      );
    }

    // Add metadata
    const credentialsWithMeta = {
      ...credentials,
      type: 'classy-api',
      version: '1.0',
      createdAt: new Date().toISOString()
    };

    return this.encrypt(credentialsWithMeta);
  }

  /**
   * Decrypt Classy API credentials
   * @param {string} encryptedCredentials - Encrypted credentials string
   * @returns {Object} Decrypted Classy credentials
   */
  decryptClassyCredentials(encryptedCredentials) {
    const credentials = this.decrypt(encryptedCredentials);
    
    // Validate decrypted data
    if (credentials.type !== 'classy-api') {
      throw new EncryptionError('Invalid credential type. Expected classy-api credentials.');
    }

    return {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      organizationId: credentials.organizationId,
      createdAt: credentials.createdAt
    };
  }

  /**
   * Test encryption/decryption functionality
   * @returns {boolean} True if test passes
   */
  testEncryption() {
    try {
      const testData = {
        clientId: 'test_client_id',
        clientSecret: 'test_client_secret', 
        organizationId: 12345
      };

      const encrypted = this.encryptClassyCredentials(testData);
      const decrypted = this.decryptClassyCredentials(encrypted);

      return (
        decrypted.clientId === testData.clientId &&
        decrypted.clientSecret === testData.clientSecret &&
        decrypted.organizationId === testData.organizationId
      );
    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance
const encryptionService = new EncryptionService();

module.exports = {
  EncryptionService,
  EncryptionError,
  encryption: encryptionService,
  
  // Direct access to methods
  encrypt: (data) => encryptionService.encrypt(data),
  decrypt: (data) => encryptionService.decrypt(data),
  encryptClassyCredentials: (creds) => encryptionService.encryptClassyCredentials(creds),
  decryptClassyCredentials: (encrypted) => encryptionService.decryptClassyCredentials(encrypted)
};