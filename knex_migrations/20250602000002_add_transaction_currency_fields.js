/**
 * Add currency fields to transactions table based on GoFundMe Pro API documentation
 * 
 * The API provides three levels of currency data:
 * 1. Raw currency (original donor intent)
 * 2. Charged currency (actual charge)  
 * 3. Normalized currency (reporting)
 * 
 * This enables proper multi-currency support and tracking
 */

exports.up = function(knex) {
  return knex.schema.alterTable('transactions', function(table) {
    // Raw currency fields (original donor intent)
    table.string('raw_currency_code', 3).nullable();
    table.decimal('raw_total_gross_amount', 10, 2).nullable();
    table.decimal('raw_donation_gross_amount', 10, 2).nullable();
    
    // Charged currency fields (actual charge to card/account)
    table.string('charged_currency_code', 3).nullable();
    table.decimal('charged_total_gross_amount', 10, 2).nullable();
    table.decimal('charged_fees_amount', 10, 2).nullable();
    table.timestamp('charged_at').nullable();
    
    // Additional relationship fields from API
    table.integer('fundraising_page_id').nullable();
    table.integer('fundraising_team_id').nullable();
    table.integer('designation_id').nullable();
    
    // Fee-related flags
    table.boolean('fee_on_top').nullable();
    table.boolean('is_donor_covered_fee').nullable();
    
    // Payment details
    table.string('payment_type', 50).nullable();
    table.string('card_type', 50).nullable();
    table.integer('card_last_four').nullable();
    
    // Add indexes for commonly queried fields
    table.index('raw_currency_code', 'idx_transactions_raw_currency');
    table.index('charged_currency_code', 'idx_transactions_charged_currency'); 
    table.index('fundraising_page_id', 'idx_transactions_fundraising_page');
    table.index('fundraising_team_id', 'idx_transactions_fundraising_team');
    table.index('charged_at', 'idx_transactions_charged_at');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('transactions', function(table) {
    // Remove currency fields
    table.dropColumn('raw_currency_code');
    table.dropColumn('raw_total_gross_amount');
    table.dropColumn('raw_donation_gross_amount');
    
    table.dropColumn('charged_currency_code');
    table.dropColumn('charged_total_gross_amount');
    table.dropColumn('charged_fees_amount');
    table.dropColumn('charged_at');
    
    // Remove relationship fields
    table.dropColumn('fundraising_page_id');
    table.dropColumn('fundraising_team_id');
    table.dropColumn('designation_id');
    
    // Remove fee flags
    table.dropColumn('fee_on_top');
    table.dropColumn('is_donor_covered_fee');
    
    // Remove payment details
    table.dropColumn('payment_type');
    table.dropColumn('card_type');
    table.dropColumn('card_last_four');
  });
};