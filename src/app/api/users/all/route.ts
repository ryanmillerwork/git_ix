import { NextResponse } from 'next/server';
import { query } from '@/lib/server/db'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

interface UserDetails {
    username: string;
    branch_permissions: string[];
    active: boolean;
}

/**
 * GET /api/users/all
 * Get all users with details (username, permissions, active status).
 */
export async function GET() {
  console.log('[API /users/all] Fetching all users...');
  try {
    // Ensure the table exists before querying - could be moved to global setup
    // await ensureUsersTableExists(); 

    // SQL query to select details for all users
    const queryText = 'SELECT username, branch_permissions, active FROM users ORDER BY username';
    const result = await query(queryText);

    // Ensure branch_permissions is always an array (it should be due to db default)
    const users: UserDetails[] = result.rows.map((user: { username: string, branch_permissions: string[] | null, active: boolean }) => ({
        ...user,
        branch_permissions: Array.isArray(user.branch_permissions) ? user.branch_permissions : [],
    }));

    console.log(`[API /users/all] Found ${users.length} users.`);
    return NextResponse.json(users);

  } catch (error: unknown) {
    console.error('[API /users/all] Error fetching all users:', error);
    let message = 'Failed to retrieve all users from database.';
    if (error instanceof Error) {
        message = error.message;
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
} 