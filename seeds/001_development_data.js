/**
 * Development Seed Data
 * 
 * Creates sample data for development and testing
 * Only runs in development environment
 */

exports.seed = function(knex) {
  // Only seed in development
  if (process.env.NODE_ENV === 'production') {
    return Promise.resolve();
  }

  // Clear existing entries (in dependency order)
  return knex('recurring_plans').del()
    .then(() => knex('transactions').del())
    .then(() => knex('campaigns').del())
    .then(() => knex('supporters').del())
    .then(() => knex('organizations').del())
    
    // Insert sample organizations
    .then(() => {
      return knex('organizations').insert([
        {
          id: 1,
          classy_id: 123456,
          name: 'Sample Nonprofit Organization',
          status: 'active',
          created_at: new Date(),
          updated_at: new Date()
        }
      ]);
    })
    
    // Insert sample campaigns
    .then(() => {
      return knex('campaigns').insert([
        {
          id: 789012,
          organization_id: 1,
          name: 'Annual Fundraising Campaign',
          status: 'active',
          type: 'crowdfunding',
          goal: 50000.00,
          total_raised: 25000.00,
          donors_count: 125,
          started_at: new Date('2025-01-01'),
          ended_at: new Date('2025-12-31'),
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 789013,
          organization_id: 1,
          name: 'Emergency Relief Fund',
          status: 'active',
          type: 'peer-to-peer',
          goal: 25000.00,
          total_raised: 15000.00,
          donors_count: 85,
          started_at: new Date('2025-02-01'),
          created_at: new Date(),
          updated_at: new Date()
        }
      ]);
    })
    
    // Insert sample supporters
    .then(() => {
      return knex('supporters').insert([
        {
          id: 345678,
          organization_id: 1,
          email_address: 'john.doe@example.com',
          first_name: 'John',
          last_name: 'Doe',
          lifetime_donation_amount: 500.00,
          lifetime_donation_count: 3,
          monthly_recurring_amount: 25.00,
          email_opt_in: true,
          city: 'San Francisco',
          state: 'CA',
          country: 'US',
          postal_code: '94102',
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 345679,
          organization_id: 1,
          email_address: 'jane.smith@example.com',
          first_name: 'Jane',
          last_name: 'Smith',
          lifetime_donation_amount: 1250.00,
          lifetime_donation_count: 5,
          monthly_recurring_amount: 50.00,
          email_opt_in: true,
          city: 'New York',
          state: 'NY',
          country: 'US',
          postal_code: '10001',
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 345680,
          organization_id: 1,
          email_address: 'bob.wilson@example.com',
          first_name: 'Bob',
          last_name: 'Wilson',
          lifetime_donation_amount: 100.00,
          lifetime_donation_count: 1,
          monthly_recurring_amount: 0.00,
          email_opt_in: false,
          city: 'Austin',
          state: 'TX',
          country: 'US',
          postal_code: '73301',
          created_at: new Date(),
          updated_at: new Date()
        }
      ]);
    })
    
    // Insert sample transactions
    .then(() => {
      return knex('transactions').insert([
        {
          id: 901234,
          organization_id: 1,
          supporter_id: 345678,
          campaign_id: 789012,
          total_gross_amount: 100.00,
          donation_gross_amount: 95.00,
          fees_amount: 5.00,
          donation_net_amount: 95.00,
          currency: 'USD',
          billing_city: 'San Francisco',
          billing_state: 'CA',
          billing_country: 'US',
          status: 'success',
          purchased_at: new Date('2025-01-15'),
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 901235,
          organization_id: 1,
          supporter_id: 345679,
          campaign_id: 789012,
          total_gross_amount: 250.00,
          donation_gross_amount: 240.00,
          fees_amount: 10.00,
          donation_net_amount: 240.00,
          currency: 'USD',
          billing_city: 'New York',
          billing_state: 'NY',
          billing_country: 'US',
          status: 'success',
          purchased_at: new Date('2025-02-01'),
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 901236,
          organization_id: 1,
          supporter_id: 345680,
          campaign_id: 789013,
          total_gross_amount: 100.00,
          donation_gross_amount: 97.00,
          fees_amount: 3.00,
          donation_net_amount: 97.00,
          currency: 'USD',
          billing_city: 'Austin',
          billing_state: 'TX',
          billing_country: 'US',
          status: 'success',
          purchased_at: new Date('2025-02-15'),
          created_at: new Date(),
          updated_at: new Date()
        }
      ]);
    })
    
    // Insert sample recurring plans
    .then(() => {
      return knex('recurring_plans').insert([
        {
          id: 567890,
          organization_id: 1,
          supporter_id: 345678,
          campaign_id: 789012,
          status: 'active',
          amount: 25.00,
          frequency: 'monthly',
          next_payment_date: new Date('2025-04-01'),
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 567891,
          organization_id: 1,
          supporter_id: 345679,
          campaign_id: 789012,
          status: 'active',
          amount: 50.00,
          frequency: 'monthly',
          next_payment_date: new Date('2025-04-01'),
          created_at: new Date(),
          updated_at: new Date()
        }
      ]);
    });
};