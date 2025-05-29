/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('donor_segmentation_config', function(table) {
    table.increments('id').primary();
    table.integer('organization_id').unsigned().references('id').inTable('organizations');
    table.string('segment_type', 50).notNullable();
    table.string('segment_name', 100).notNullable();
    table.decimal('min_amount', 10, 2).nullable();
    table.decimal('max_amount', 10, 2).nullable();
    table.integer('min_count').nullable();
    table.integer('max_count').nullable();
    table.integer('days_threshold').nullable();
    table.text('description');
    table.string('color_code', 10);
    table.integer('sort_order').defaultTo(0);
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
    
    table.unique(['organization_id', 'segment_type', 'segment_name'], 'unique_segment');
    table.index(['organization_id', 'segment_type'], 'idx_org_type');
    table.index(['min_amount', 'max_amount'], 'idx_amounts');
    table.index(['min_count', 'max_count'], 'idx_counts');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('donor_segmentation_config');
};