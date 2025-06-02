// Jest setup file for database and environment configuration

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Global test timeout for database operations
jest.setTimeout(10000);

// Global test utilities
global.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Database test helpers
global.dbHelpers = {
  formatTimestamp: (timestamp) => {
    if (!timestamp) return null;
    return timestamp.replace(/T/, ' ').replace(/\+\d{4}$/, '').replace(/Z$/, '');
  },
  
  createTestSupporter: (overrides = {}) => ({
    id: 999999,
    email_address: 'test@example.com',
    first_name: 'Test',
    last_name: 'User',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides
  }),
  
  createTestTransaction: (overrides = {}) => ({
    id: 999999,
    supporter_id: 999999,
    campaign_id: 999999,
    gross_amount: 25.00,
    net_amount: 22.50,
    status: 'success',
    transaction_type: 'donation',
    purchased_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides
  })
};

// Mock console methods to reduce test noise
const originalConsole = { ...console };

beforeAll(() => {
  // Only show console.error during tests, suppress info/debug
  console.info = jest.fn();
  console.debug = jest.fn();
  console.log = jest.fn();
  // Keep console.error for important test failures
});

afterAll(() => {
  // Restore console methods
  Object.assign(console, originalConsole);
});

// Custom Jest matchers
expect.extend({
  toBeOneOf(received, array) {
    const pass = array.includes(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be one of ${array.join(', ')}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be one of ${array.join(', ')}`,
        pass: false,
      };
    }
  },
});