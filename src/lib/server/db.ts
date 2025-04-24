import { Pool } from 'pg';

// Use Pool for better connection management
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Add SSL configuration if required for your deployment (e.g., Vercel Postgres)
  // ssl: {
  //   rejectUnauthorized: false // Adjust based on your security requirements
  // }
});

pool.on('connect', () => {
    console.log('[DB] Connected to PostgreSQL pool.');
});

pool.on('error', (err: Error) => {
    console.error('[DB] Unexpected error on idle client', err);
    // Consider exiting the process or implementing reconnection logic if needed
});

// Function to execute a query using the pool
export const query = async (text: string, params?: (string | number | boolean | null | string[])[]) => {
    const start = Date.now();
    const client = await pool.connect(); // Get client from pool
    try {
        const res = await client.query(text, params);
        const duration = Date.now() - start;
        console.log('[DB Query] Executed query', { text: text.substring(0, 50)+'...', duration, rows: res.rowCount });
        return res;
    } catch (err) {
        console.error('[DB Query Error]', { text: text.substring(0, 50)+'...', params }, err);
        throw err; // Re-throw the error after logging
    } finally {
        client.release(); // Always release the client back to the pool
    }
};

// Check to make sure the users table exists and create it if not
// Export it to be called, e.g., in a layout or specific API routes needing it.
export async function ensureUsersTableExists() {
  console.log('[DB] Checking if users table exists...');
  try {
    const result = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) AS "exists"
    `);

    if (result.rows[0].exists) {
      console.log('[DB] users table found.');
    } else {
      console.log('[DB] users table not found. Creating...');
      await query(`
        CREATE TABLE users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) NOT NULL UNIQUE,
          email VARCHAR(255),
          password_hash VARCHAR(255) NOT NULL,
          branch_permissions TEXT[] NOT NULL DEFAULT '{}', -- Default to empty array
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_login TIMESTAMP WITH TIME ZONE,
          active BOOLEAN DEFAULT FALSE
        );
      `);
      console.log('[DB] users table created successfully.');
    }
  } catch (err: unknown) {
    console.error('[DB] Error ensuring users table exists:', err);
    // Depending on the error, you might want to throw it or handle it differently
    throw new Error('Failed to ensure users table exists.');
  }
}

// Example of potentially calling it on module load (use with caution in serverless environments)
// ensureUsersTableExists().catch(err => console.error("Initial DB setup failed:", err));

// Export the pool directly if needed elsewhere, though using the query function is preferred
export { pool }; 