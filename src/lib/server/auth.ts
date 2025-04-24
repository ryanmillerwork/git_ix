import bcrypt from 'bcrypt';
import { query } from './db'; // Import the query function from db.ts

interface UserRecord {
    id: number;
    username: string;
    email?: string | null;
    password_hash: string;
    branch_permissions: string[];
    created_at: Date;
    updated_at: Date;
    last_login?: Date | null;
    active: boolean;
}

interface ValidationResult {
    valid: boolean;
    reason?: string;
    user?: Partial<UserRecord>; // Return partial user info on success
}

/**
 * Validates user credentials and optionally checks branch permissions.
 * Updates last_login timestamp on successful validation.
 */
export async function validateUser(username: string, password?: string, branch?: string | null): Promise<ValidationResult> {
  if (!username || !password) {
    // Allow validation without password if password param is explicitly omitted (e.g. for admin self-check)
    if (password === undefined) {
        console.warn(`[Auth] Attempting validation for ${username} without password. This should only be for specific internal checks.`);
    } else {
         return { valid: false, reason: 'Username and password are required.' };
    }
  }
  console.log(`[Auth] Validating user: ${username} ${branch ? 'for branch: ' + branch : ''}`);
  try {
    // Retrieve the user from the database by username.
    const queryText = 'SELECT * FROM users WHERE username = $1';
    const result = await query(queryText, [username]);

    // If no user is found, validation fails.
    if (result.rows.length === 0) {
      console.log(`[Auth] User not found: ${username}`);
      return { valid: false, reason: 'User not found' };
    }

    const user: UserRecord = result.rows[0];

    // Check if the account is active.
    if (!user.active) {
       console.log(`[Auth] Account inactive: ${username}`);
      return { valid: false, reason: 'Account is inactive' };
    }

    // Validate the password using bcrypt if provided
    if (password) { 
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
           console.log(`[Auth] Invalid password for user: ${username}`);
          return { valid: false, reason: 'Invalid password' };
        }
    } else {
        // If no password provided for validation, log a warning but allow proceeding
        console.warn(`[Auth] Proceeding with validation for ${username} without password comparison.`);
    }

    // Check branch permissions ONLY if user is not admin and a branch is provided
    if (username !== 'admin' && branch && 
        (!user.branch_permissions || !user.branch_permissions.includes(branch))) {
       console.log(`[Auth] Branch not permitted (${branch}) for user: ${username}`);
      return { valid: false, reason: 'Branch not permitted' };
    }

    // Everything checks out; update last_login timestamp (don't wait for this)
    const updateQueryText = `
      UPDATE users 
      SET last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $1
    `;
    query(updateQueryText, [user.id]).catch(err => {
        // Log error but don't fail validation if timestamp update fails
        console.error(`[Auth] Failed to update last_login for user ${username}:`, err);
    });

    // If all checks pass, return a success response with relevant user info (exclude password hash)
    console.log(`[Auth] Validation successful for user: ${username}`);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...userInfo } = user;
    return { valid: true, user: userInfo };

  } catch (error) {
    console.error(`[Auth] Error during user validation for ${username}:`, error);
    return { valid: false, reason: 'Error during validation process' };
  }
} 