import { NextResponse } from 'next/server';
import { query } from '@/lib/server/db'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * GET /api/users
 * Get all active users (usernames only).
 */
export async function GET() {
  console.log('[API /users] Fetching active users...');
  try {
    // Ensure the table exists before querying - could be moved to global setup
    // await ensureUsersTableExists(); 
    
    // SQL query to select usernames of active users
    const queryText = 'SELECT username FROM users WHERE active = true ORDER BY username';
    const result = await query(queryText);
    
    console.log(`[API /users] Found ${result.rows.length} active users.`);
    return NextResponse.json(result.rows);

  } catch (error: any) {
    console.error('[API /users] Error fetching active users:', error);
    return NextResponse.json({ error: 'Failed to retrieve users from database.' }, { status: 500 });
  }
} 