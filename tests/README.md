# Test Suite Documentation

This directory contains comprehensive unit tests for the GoFundMe Pro data synchronization system.

## Test Categories

### 🗄️ Database Tests (`database.test.js`)
Tests the core database abstraction layer and SQL compatibility:

- **Database Type Detection**: Validates correct detection of MySQL, SQLite, PostgreSQL
- **Connection Management**: Tests connection, health checks, and error handling  
- **SQL Syntax Compatibility**: Ensures queries work across different database types
- **Parameterized Query Safety**: Validates SQL injection protection

### 🔄 Sync Engine Tests (`sync-engine.test.js`)
Tests the core synchronization logic and recent critical fixes:

- **Timestamp Tracking**: Tests the fix for using actual data timestamps vs job timestamps
- **URL Encoding**: Validates proper encoding of datetime parameters for GoFundMe Pro API
- **Database Compatibility**: Tests SQL syntax selection based on database type
- **Sync Job Logging**: Validates proper tracking and status updates

### 👥 Supporters Tests (`supporters.test.js`)
Tests supporter-specific sync logic including timeout handling:

- **Timeout Handling**: Tests graceful fallback when supporters API is slow (60s timeout)
- **SQL Syntax**: Validates MySQL/SQLite compatibility for supporter operations
- **Statistics Calculation**: Tests lifetime stats recalculation SQL
- **Data Validation**: Tests handling of incomplete or malformed supporter data

## Running Tests

### Prerequisites
```bash
# Install test dependencies
npm install --save-dev jest
```

### Run All Tests
```bash
# Run entire test suite
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- database.test.js

# Run tests in watch mode
npm test -- --watch
```

### Run Quick Tests (No External Dependencies)
```bash
# Database type detection test
node scripts/test-db-type.js

# Supporter stats SQL validation  
node scripts/test-supporter-stats.js
```

## Test Configuration

### Environment Setup
Tests use the same database configuration as the main application. Ensure your `.env` file is properly configured.

### Mocking Strategy
- **API Clients**: Mocked to avoid external API calls during testing
- **Database**: Uses real database connection but with safe test queries
- **Timeouts**: Simulated to test error handling without waiting

## Critical Fixes Tested

### 🚨 Sync Gap Resolution (May 2025)
Tests validate the fixes that resolved the 4+ day sync gap:

1. **Timestamp Tracking Bug** (`sync-engine.test.js`)
   - Tests `getLastSyncTime()` uses actual data timestamps
   - Validates fallback behavior for missing data

2. **URL Encoding Requirements** (`sync-engine.test.js`)
   - Tests proper encoding of datetime parameters
   - Validates GoFundMe Pro API compatibility

3. **MySQL Syntax Compatibility** (`supporters.test.js`, `database.test.js`)
   - Tests correct `NOW()` vs `datetime('now')` usage
   - Validates database type detection accuracy

4. **Timeout Handling** (`supporters.test.js`)
   - Tests 60-second timeout for slow supporters API
   - Validates graceful fallback behavior

## Test Data Safety

### No External API Calls
All tests use mocked API responses to:
- Avoid consuming API rate limits
- Prevent dependency on external service availability
- Enable fast, reliable test execution

### Safe Database Operations
Tests use:
- Non-existent IDs (999999) for UPDATE operations that won't affect real data
- SELECT queries for syntax validation
- Rollback-safe operations

### Performance Focused
- Tests complete in seconds, not minutes
- No dependency on large dataset operations
- Isolated test cases that don't interfere with each other

## Adding New Tests

### Test Structure
```javascript
describe('Feature Name', () => {
  describe('Specific Functionality', () => {
    test('should behave correctly', async () => {
      // Test implementation
    });
  });
});
```

### Best Practices
1. **Mock External Dependencies**: API calls, file system operations
2. **Test Error Conditions**: Network failures, invalid data, timeouts
3. **Validate SQL Syntax**: Ensure database compatibility
4. **Use Descriptive Names**: Clear test descriptions and assertions
5. **Test Performance**: Ensure tests run quickly without external dependencies

## Continuous Integration

These tests are designed to run in CI/CD environments:
- No external API dependencies
- Database agnostic (SQLite for CI, MySQL for dev/prod)
- Fast execution (under 30 seconds for full suite)
- Clear error reporting and debugging information