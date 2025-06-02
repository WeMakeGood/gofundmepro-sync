const { EncryptionUtil } = require('../src/utils/encryption');

describe('EncryptionUtil', () => {
  let encryption;

  beforeAll(() => {
    // Set test encryption hash
    process.env.ENCRYPTION_HASH = 'test_hash_for_encryption_tests_12345678901234567890';
    encryption = new EncryptionUtil();
  });

  afterAll(() => {
    delete process.env.ENCRYPTION_HASH;
  });

  describe('Basic Encryption/Decryption', () => {
    test('should encrypt and decrypt simple strings', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);

      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toBeTruthy();
      expect(decrypted).toBe(plaintext);
    });

    test('should handle empty strings', () => {
      const result = encryption.encrypt('');
      expect(result).toBeTruthy();
      
      const decrypted = encryption.decrypt(result);
      expect(decrypted).toBe('');
    });

    test('should handle null values', () => {
      expect(encryption.encrypt(null)).toBeNull();
      expect(encryption.decrypt(null)).toBeNull();
    });

    test('should generate different encrypted values for same input', () => {
      const plaintext = 'test data';
      const encrypted1 = encryption.encrypt(plaintext);
      const encrypted2 = encryption.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2); // Different IVs
      expect(encryption.decrypt(encrypted1)).toBe(plaintext);
      expect(encryption.decrypt(encrypted2)).toBe(plaintext);
    });
  });

  describe('Credential Encryption', () => {
    test('should encrypt and decrypt credential objects', () => {
      const credentials = {
        classy_client_id: 'test_client_id_123',
        classy_client_secret: 'test_secret_456',
        mailchimp_api_key: 'test_mailchimp_key_789',
        mailchimp_server_prefix: 'us15',
        mailchimp_audience_id: 'audience123'
      };

      const encrypted = encryption.encryptCredentials(credentials);
      const decrypted = encryption.decryptCredentials(encrypted);

      // Check all fields are encrypted (different from original)
      Object.keys(credentials).forEach(key => {
        expect(encrypted[key]).not.toBe(credentials[key]);
        expect(encrypted[key]).toBeTruthy();
      });

      // Check decryption restores original values
      expect(decrypted).toEqual(credentials);
    });

    test('should handle partial credential objects', () => {
      const credentials = {
        classy_client_id: 'test_id',
        classy_client_secret: null,
        empty_field: '',
        undefined_field: undefined
      };

      const encrypted = encryption.encryptCredentials(credentials);
      const decrypted = encryption.decryptCredentials(encrypted);

      expect(decrypted.classy_client_id).toBe('test_id');
      expect(decrypted.classy_client_secret).toBeNull();
      expect(decrypted.empty_field).toBe(''); // Empty string encrypts and decrypts to empty string
      expect(decrypted.undefined_field).toBeUndefined();
    });

    test('should handle mixed encrypted/plaintext objects (migration scenario)', () => {
      const mixedCredentials = {
        encrypted_field: encryption.encrypt('encrypted_value'),
        plaintext_field: 'plaintext_value' // Not encrypted
      };

      const decrypted = encryption.decryptCredentials(mixedCredentials);

      expect(decrypted.encrypted_field).toBe('encrypted_value');
      expect(decrypted.plaintext_field).toBe('plaintext_value'); // Fallback to plaintext
    });
  });

  describe('Validation and Utilities', () => {
    test('should validate encryption is working', () => {
      expect(encryption.validateEncryption()).toBe(true);
    });

    test('should generate random encryption hashes', () => {
      const hash1 = EncryptionUtil.generateEncryptionHash();
      const hash2 = EncryptionUtil.generateEncryptionHash();

      expect(hash1).toHaveLength(64); // 32 bytes as hex = 64 chars
      expect(hash2).toHaveLength(64);
      expect(hash1).not.toBe(hash2);
      expect(/^[a-f0-9]+$/i.test(hash1)).toBe(true); // Valid hex
    });

    test('should fail without encryption hash', () => {
      delete process.env.ENCRYPTION_HASH;
      const tempEncryption = new EncryptionUtil();

      expect(() => {
        tempEncryption.encrypt('test');
      }).toThrow('ENCRYPTION_HASH environment variable is required');

      // Restore for other tests
      process.env.ENCRYPTION_HASH = 'test_hash_for_encryption_tests_12345678901234567890';
    });
  });

  describe('Error Handling', () => {
    test('should handle corrupted encrypted data', () => {
      expect(() => {
        encryption.decrypt('invalid_base64_data');
      }).toThrow('Decryption failed');
    });

    test('should handle tampered encrypted data', () => {
      const encrypted = encryption.encrypt('test data');
      const tampered = encrypted.slice(0, -1) + 'X'; // Change last character

      expect(() => {
        encryption.decrypt(tampered);
      }).toThrow('Decryption failed');
    });
  });
});