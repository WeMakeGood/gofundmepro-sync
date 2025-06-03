/**
 * Classy API Filter Helper
 * 
 * Provides standardized filter construction for the Classy API.
 * Handles proper datetime formatting and URL encoding for server-side filtering.
 */
class ClassyFilters {
  /**
   * Create a date filter string with proper formatting and encoding
   * @param {string} field - The field name (e.g., 'updated_at', 'created_at', 'purchased_at')
   * @param {string} operator - The comparison operator (>, >=, <, <=, =, !=, <>)
   * @param {Date} date - The date to filter by
   * @param {boolean} simpleDateOnly - If true, use YYYY-MM-DD format instead of full datetime
   * @returns {string} URL-encoded filter string
   */
  static dateFilter(field, operator, date, simpleDateOnly = true) {
    if (!(date instanceof Date)) {
      throw new Error('Date parameter must be a Date object');
    }
    
    let dateString;
    if (simpleDateOnly) {
      // Use simple YYYY-MM-DD format (works reliably for most organizations)
      dateString = date.toISOString().split('T')[0];
    } else {
      // Convert to ISO string and replace .000Z with +0000 as specified by Classy tech team
      // Example: 2025-04-20T00:00:00.000Z -> 2025-04-20T00:00:00+0000
      dateString = date.toISOString().replace(/\.\d{3}Z$/, '+0000');
    }
    
    // Only URL encode if needed (datetime formats need encoding, simple dates don't)
    const encodedDate = simpleDateOnly ? dateString : encodeURIComponent(dateString);
    
    return `${field}${operator}${encodedDate}`;
  }
  
  /**
   * Create a simple date filter (YYYY-MM-DD format) - more reliable for some orgs
   * @param {string} field - The field name
   * @param {string} operator - The comparison operator  
   * @param {Date} date - The date to filter by
   * @returns {string} Filter string using simple date format
   */
  static simpleDateFilter(field, operator, date) {
    return this.dateFilter(field, operator, date, true);
  }
  
  /**
   * Filter for records updated since a specific date
   * @param {Date} date - The date to filter from
   * @returns {string} Filter string for updated_at > date
   */
  static updatedSince(date, simpleDateOnly = true) {
    return this.dateFilter('updated_at', '>', date, simpleDateOnly);
  }
  
  /**
   * Filter for records purchased since a specific date (transactions)
   * @param {Date} date - The date to filter from
   * @returns {string} Filter string for purchased_at > date
   */
  static purchasedSince(date, simpleDateOnly = true) {
    return this.dateFilter('purchased_at', '>', date, simpleDateOnly);
  }
  
  /**
   * Filter for records created since a specific date
   * @param {Date} date - The date to filter from
   * @returns {string} Filter string for created_at > date
   */
  static createdSince(date, simpleDateOnly = true) {
    return this.dateFilter('created_at', '>', date, simpleDateOnly);
  }
  
  /**
   * Filter for records updated before a specific date
   * @param {Date} date - The date to filter to
   * @returns {string} Filter string for updated_at < date
   */
  static updatedBefore(date, simpleDateOnly = true) {
    return this.dateFilter('updated_at', '<', date, simpleDateOnly);
  }
  
  /**
   * Filter for records within a date range
   * @param {string} field - The date field to filter on
   * @param {Date} startDate - The start date (inclusive)
   * @param {Date} endDate - The end date (inclusive)
   * @returns {string} Filter string for date range
   */
  static dateRange(field, startDate, endDate, simpleDateOnly = true) {
    const startFilter = this.dateFilter(field, '>=', startDate, simpleDateOnly);
    const endFilter = this.dateFilter(field, '<=', endDate, simpleDateOnly);
    return `${startFilter}&${endFilter}`;
  }
  
  /**
   * Filter for boolean fields
   * @param {string} field - The boolean field name
   * @param {boolean} value - The boolean value to filter by
   * @returns {string} Filter string for boolean field
   */
  static booleanFilter(field, value) {
    const filterValue = value ? 'true' : 'false';
    return `${field}=${filterValue}`;
  }
  
  /**
   * Filter for string equality with proper encoding
   * @param {string} field - The field name
   * @param {string} value - The value to match
   * @returns {string} Filter string for exact match
   */
  static exactMatch(field, value) {
    return `${field}=${encodeURIComponent(value)}`;
  }
  
  /**
   * Combine multiple filters with AND logic
   * @param {...string} filters - Filter strings to combine
   * @returns {string} Combined filter string
   */
  static and(...filters) {
    return filters.filter(f => f && f.length > 0).join('&');
  }
  
  /**
   * Validate that a filter string is properly formatted
   * @param {string} filter - The filter string to validate
   * @returns {boolean} True if valid, false otherwise
   */
  static isValidFilter(filter) {
    if (!filter || typeof filter !== 'string') {
      return false;
    }
    
    // Basic validation - should contain field, operator, and value
    const filterPattern = /^[a-zA-Z_][a-zA-Z0-9_]*[><=!]+.+/;
    return filterPattern.test(filter);
  }
}

module.exports = ClassyFilters;