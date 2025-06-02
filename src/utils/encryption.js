const crypto = require('crypto');

class EncryptionUtil {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 16;  // 128 bits
    this.tagLength = 16; // 128 bits
  }

  /**
   * Get encryption key from environment variable
   * @returns {Buffer} The encryption key
   */
  getEncryptionKey() {
    const encryptionHash = process.env.ENCRYPTION_HASH;
    if (!encryptionHash) {
      throw new Error('ENCRYPTION_HASH environment variable is required for credential encryption');
    }
    
    // Create a consistent 256-bit key from the hash
    return crypto.scryptSync(encryptionHash, 'sync-salt', this.keyLength);
  }

  /**
   * Encrypt sensitive data (like API credentials)
   * @param {string} plaintext - The data to encrypt
   * @returns {string} Base64 encoded encrypted data with IV and tag
   */
  encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) {
      return null;
    }

    try {
      const key = this.getEncryptionKey();
      const iv = crypto.randomBytes(this.ivLength);

      // Use GCM mode for authenticated encryption  
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);
      
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();
      
      // Combine IV + encrypted data + tag
      const combined = Buffer.concat([iv, Buffer.from(encrypted, 'hex'), tag]);
      
      return combined.toString('base64');
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt sensitive data
   * @param {string} encryptedData - Base64 encoded encrypted data
   * @returns {string} The decrypted plaintext
   */
  decrypt(encryptedData) {
    if (encryptedData === null || encryptedData === undefined) {
      return null;
    }

    try {
      const key = this.getEncryptionKey();
      const combined = Buffer.from(encryptedData, 'base64');
      
      // Extract IV, encrypted data, and tag
      const iv = combined.slice(0, this.ivLength);
      const tag = combined.slice(-this.tagLength);
      const encrypted = combined.slice(this.ivLength, -this.tagLength);
      
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Encrypt an object containing API credentials
   * @param {Object} credentials - Object with API credentials
   * @returns {Object} Object with encrypted credentials
   */
  encryptCredentials(credentials) {
    const encrypted = {};
    
    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value === 'string') {
        encrypted[key] = this.encrypt(value);
      } else {
        encrypted[key] = value;
      }
    }
    
    return encrypted;
  }

  /**
   * Decrypt an object containing encrypted API credentials
   * @param {Object} encryptedCredentials - Object with encrypted credentials
   * @returns {Object} Object with decrypted credentials
   */
  decryptCredentials(encryptedCredentials) {
    const decrypted = {};
    
    for (const [key, value] of Object.entries(encryptedCredentials)) {
      if (typeof value === 'string') {
        try {
          decrypted[key] = this.decrypt(value);
        } catch (error) {
          // If decryption fails, assume it's already plaintext (for migration)
          decrypted[key] = value;
        }
      } else {
        decrypted[key] = value;
      }
    }
    
    return decrypted;
  }

  /**
   * Generate a random encryption hash for new installations
   * @returns {string} A random hash suitable for ENCRYPTION_HASH
   */
  static generateEncryptionHash() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Validate that encryption/decryption is working properly
   * @returns {boolean} True if encryption is working
   */
  validateEncryption() {
    try {
      const testData = 'test-encryption-' + Date.now();
      const encrypted = this.encrypt(testData);
      const decrypted = this.decrypt(encrypted);
      return decrypted === testData;
    } catch (error) {
      return false;
    }
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new EncryptionUtil();
  }
  return instance;
}

module.exports = {
  EncryptionUtil,
  getInstance
};