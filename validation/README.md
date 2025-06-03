# Classy API Validation Test Suite

This validation suite tests our implementation assumptions against live Classy API data before building the full system.

## 🎯 Purpose

1. **Validate Authentication** - Ensure API credentials work correctly
2. **Test API Response Structure** - Compare live responses to JSON specification
3. **Validate Server-Side Filtering** - Confirm filtering capabilities and optimal formats
4. **Analyze Data Structures** - Generate database schema from actual field patterns

## 🛠️ Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Classy API credentials
   ```

   Required variables:
   - `CLASSY_CLIENT_ID` - Your Classy API client ID
   - `CLASSY_CLIENT_SECRET` - Your Classy API client secret  
   - `CLASSY_ORGANIZATION_ID` - Your organization ID for testing

## 🧪 Running Tests

### Run All Tests (Recommended)
```bash
npm run test:all
```

### Individual Tests
```bash
# Test authentication only
npm run test:auth

# Test API response structure
npm run test:api

# Test server-side filtering
npm run test:filtering

# Analyze data structures
npm run test:schema
```

## 📊 Test Details

### Test 1: Authentication (`test-auth.js`)
- Validates OAuth2 client credentials flow
- Tests authenticated API requests
- Confirms organization ID access

**Expected Output:**
```
✅ Authentication successful
✅ Authenticated request successful  
✅ Organization ID validated
```

### Test 2: API Responses (`test-api-responses.js`)
- Fetches sample data from all entity endpoints
- Validates field existence vs our assumptions
- Identifies missing or renamed fields

**Key Validations:**
- Campaign fields: `type` vs `campaign_type`, `started_at` vs `start_date`
- Transaction multi-currency fields: `raw_currency_code`, etc.
- Relationship fields: `fundraising_page_id`, `fundraising_team_id`

### Test 3: Server-Side Filtering (`test-filtering.js`)
- Tests different date formats for filtering
- Validates filter effectiveness (result reduction)
- Identifies which entities support which filters

**Date Formats Tested:**
- Simple date: `2020-01-01`
- ISO date: `2020-01-01`
- ISO datetime: `2020-01-01T00:00:00.000Z`
- URL encoded datetime: `2020-01-01T00%3A00%3A00.000Z`

### Test 4: Data Structure Analysis (`analyze-data-structures.js`)
- Analyzes field types, nullability, and patterns
- Generates database schema recommendations
- Saves detailed analysis to `data-structure-analysis.json`

**Output:** Complete field analysis and recommended SQL schema

## 📋 Expected Outcomes

### ✅ Success Criteria
1. **Authentication works** - API credentials are valid
2. **Data available** - Each entity returns sample records
3. **Filtering works** - Server-side filters reduce result sets
4. **Schema validated** - Field names and types match our assumptions

### 🚨 Potential Issues to Watch For
1. **Field name mismatches** - `campaign_type` vs `type`, etc.
2. **Missing multi-currency fields** - May need schema adjustments
3. **Filtering limitations** - Some entities may not support all filters
4. **Data type surprises** - IDs as strings vs numbers, etc.

## 📄 Output Files

- `validation/data-structure-analysis.json` - Complete field analysis
- Console output with pass/fail results for each test
- Detailed field validation and recommendations

## 🔄 Next Steps

Based on test results:

1. **If all tests pass** → Proceed with implementation using validated schema
2. **If field mismatches found** → Update CLAUDE.md schema with correct field names
3. **If filtering issues** → Adjust API client filtering strategy
4. **If authentication fails** → Verify credentials and organization access

## 🐛 Troubleshooting

### Authentication Fails
- Verify `CLASSY_CLIENT_ID` and `CLASSY_CLIENT_SECRET`
- Check organization access permissions
- Confirm API credentials are for the correct environment

### No Data Returned
- Organization may have no records for that entity type
- Try different organization ID with more data
- Check organization status (active vs inactive)

### Filtering Fails
- Some entities may not support all filter types
- Date format requirements may vary by endpoint
- Check API rate limits and retry logic

---

**Run the tests before implementing to ensure our assumptions are correct!**