import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { query } from '@/lib/server/db'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * POST /api/users/new
 * Create a new user.
 */
export async function POST(request: Request) {
  console.log('[API /users/new] Received request');
  let body;
  try {
    body = await request.json();
    console.log('[API /users/new] Request body parsed:', { username: body?.username, email: body?.email, hasPassword: !!body?.password, permissions: body?.branch_permissions });
  } catch (e) {
    console.error('[API /users/new] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, email, password, branch_permissions } = body;

  // Validate required fields
  if (!username || !password || !Array.isArray(branch_permissions)) {
    console.log('[API /users/new] Validation failed: Missing fields');
    return NextResponse.json({ error: 'username, password, and branch_permissions (array) are required' }, { status: 400 });
  }

  // Sanitize permissions just in case
  const sanitizedPermissions = branch_permissions.filter((p): p is string => typeof p === 'string');

  if (sanitizedPermissions.length === 0 && username !== 'admin') {
      // Allow empty permissions only for admin creation maybe? Or require at least one?
      // Current frontend requires at least one permission.
      console.log('[API /users/new] Validation failed: No valid branch permissions provided.');
      return NextResponse.json({ error: 'At least one valid branch permission is required' }, { status: 400 });
  }

  try {
    // Hash the password with bcrypt
    const saltRounds = 10;
    console.log('[API /users/new] Hashing password...');
    const password_hash = await bcrypt.hash(password, saltRounds);
    console.log('[API /users/new] Password hashed.');

    // SQL query to insert the new user into the 'users' table
    // Note: Default active status is FALSE in the DB schema
    const queryText = `
      INSERT INTO users (username, email, password_hash, branch_permissions)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, email, branch_permissions, created_at, active;
    `;
    const values = [username, email || null, password_hash, sanitizedPermissions];

    console.log('[API /users/new] Executing insert query...');
    const result = await query(queryText, values);
    console.log('[API /users/new] User created successfully:', result.rows[0]);
    
    // Return the newly created user info (excluding password hash)
    return NextResponse.json(result.rows[0], { status: 201 }); // 201 Created

  } catch (error: unknown) {
    console.error('[API /users/new] Error creating user:', error);
    let message = 'Failed to create user due to database error.';
    let status = 500;
    // Check for duplicate username error (unique constraint violation)
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        console.log('[API /users/new] Duplicate username error.');
        message = 'Username already exists';
        status = 409; // 409 Conflict
    } else if (error instanceof Error) {
         message = error.message;
         console.error('[API /users/new] Database error:', message);
    } else {
        console.error('[API /users/new] Generic database error.', error);
    }
    return NextResponse.json({ error: message }, { status });
  }
} 