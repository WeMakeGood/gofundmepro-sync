/**
 * Simple AES Encryption for Classy Credentials
 * 
 * Simplified implementation using AES-256-CBC for reliable encryption
 */

const crypto = require('crypto');

class EncryptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EncryptionError';
  }
}

class SimpleEncryption {
  constructor() {
    this.algorithm = 'aes-256-cbc';
    this.keyLength = 32; // 256 bits
    this.ivLength = 16;  // 128 bits
    
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
        'ENCRYPTION_KEY not found in environment variables.'
      );
    }
    
    if (keyHex.length !== 64) { // 32 bytes = 64 hex characters
      throw new EncryptionError(
        'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).'
      );
    }
    
    try {
      return Buffer.from(keyHex, 'hex');
    } catch (error) {
      throw new EncryptionError('Invalid ENCRYPTION_KEY format. Must be valid hex string.');
    }
  }

  /**
   * Encrypt data
   * @param {Object} data - Data to encrypt
   * @returns {string} Base64 encoded encrypted data
   */
  encrypt(data) {
    try {
      const plaintext = JSON.stringify(data);
      const iv = crypto.randomBytes(this.ivLength);
      
      const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);
      
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Combine IV and encrypted data
      const combined = iv.toString('hex') + ':' + encrypted;
      
      return Buffer.from(combined).toString('base64');
      
    } catch (error) {
      throw new EncryptionError(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt data
   * @param {string} encryptedData - Base64 encoded encrypted data
   * @returns {Object} Decrypted data
   */
  decrypt(encryptedData) {
    try {
      const combined = Buffer.from(encryptedData, 'base64').toString();
      const [ivHex, encrypted] = combined.split(':');
      
      const iv = Buffer.from(ivHex, 'hex');
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
      
    } catch (error) {
      throw new EncryptionError(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Encrypt Classy credentials
   * @param {Object} credentials - Classy credentials
   * @returns {string} Encrypted credentials
   */
  encryptClassyCredentials(credentials) {
    if (!credentials.clientId || !credentials.clientSecret || !credentials.organizationId) {
      throw new EncryptionError('Missing required Classy credentials');
    }

    const credentialsWithMeta = {
      ...credentials,
      type: 'classy-api',
      version: '1.0',
      createdAt: new Date().toISOString()
    };

    return this.encrypt(credentialsWithMeta);
  }

  /**
   * Decrypt Classy credentials
   * @param {string} encryptedCredentials - Encrypted credentials
   * @returns {Object} Decrypted credentials
   */
  decryptClassyCredentials(encryptedCredentials) {
    const credentials = this.decrypt(encryptedCredentials);
    
    if (credentials.type !== 'classy-api') {
      throw new EncryptionError('Invalid credential type');
    }

    return {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      organizationId: credentials.organizationId,
      createdAt: credentials.createdAt
    };
  }

  /**
   * Test encryption/decryption
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

// Export singleton
const simpleEncryption = new SimpleEncryption();

module.exports = {
  SimpleEncryption,
  EncryptionError,
  encryption: simpleEncryption,
  encrypt: (data) => simpleEncryption.encrypt(data),
  decrypt: (data) => simpleEncryption.decrypt(data),
  encryptClassyCredentials: (creds) => simpleEncryption.encryptClassyCredentials(creds),
  decryptClassyCredentials: (encrypted) => simpleEncryption.decryptClassyCredentials(encrypted)
};