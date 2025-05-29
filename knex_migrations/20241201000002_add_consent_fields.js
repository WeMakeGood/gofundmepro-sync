/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('supporters', function(table) {
    table.boolean('email_opt_in').nullable();
    table.boolean('sms_opt_in').nullable();
    table.timestamp('last_email_consent_date').nullable();
    table.timestamp('last_sms_consent_date').nullable();
    table.timestamp('last_emailed_at').nullable();
    table.text('communication_preferences').nullable();
    
    table.index('email_opt_in', 'idx_supporters_email_opt_in');
    table.index('sms_opt_in', 'idx_supporters_sms_opt_in');
    table.index('last_email_consent_date', 'idx_supporters_email_consent_date');
    table.index('last_sms_consent_date', 'idx_supporters_sms_consent_date');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('supporters', function(table) {
    table.dropColumn('email_opt_in');
    table.dropColumn('sms_opt_in');
    table.dropColumn('last_email_consent_date');
    table.dropColumn('last_sms_consent_date');
    table.dropColumn('last_emailed_at');
    table.dropColumn('communication_preferences');
  });
};