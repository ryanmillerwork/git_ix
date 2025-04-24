import { NextResponse } from 'next/server';
import { query } from '@/lib/server/db'; // Adjust path as needed
import { validateUser } from '@/lib/server/auth'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * POST /api/users/update-status
 * Activate, deactivate, delete, OR update permissions for a user.
 */
export async function POST(request: Request) {
  console.log('[API /users/update-status] Received request');
  let body;
  try {
    body = await request.json();
    console.log('[API /users/update-status] Request body parsed:', { admin: body?.adminUsername, target: body?.targetUsername, action: body?.action, hasPerms: Array.isArray(body?.branch_permissions) });
  } catch (e) {
    console.error('[API /users/update-status] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { adminUsername, adminPassword, targetUsername, action, branch_permissions } = body; 

  // --- Validation ---
  if (!adminUsername || !adminPassword || !targetUsername) {
     console.log('[API /users/update-status] Validation failed: Missing required fields.');
    return NextResponse.json({ error: 'Missing required fields: adminUsername, adminPassword, targetUsername' }, { status: 400 });
  }
  const validActions = ['activate', 'deactivate', 'delete', 'update_perms'];
  const hasValidAction = action && validActions.includes(action);
  // Permissions can be undefined (if only doing activate/deactivate/delete) or an array (for update_perms or combined actions)
  const hasPermissionsField = branch_permissions !== undefined;
  const hasValidPermissionsArray = hasPermissionsField && Array.isArray(branch_permissions);

  if (!hasValidAction && !hasValidPermissionsArray) {
      console.log('[API /users/update-status] Validation failed: No valid action or permissions array provided.');
      return NextResponse.json({ error: 'Invalid request: Must provide a valid action (activate/deactivate/delete/update_perms) or branch_permissions array.' }, { status: 400 });
  }
  if (hasPermissionsField && !hasValidPermissionsArray) {
      console.log('[API /users/update-status] Validation failed: branch_permissions field exists but is not an array.');
      return NextResponse.json({ error: 'Invalid request: branch_permissions must be an array.' }, { status: 400 });
  }

  // Admin Validation 
  if (adminUsername !== 'admin') {
      console.log(`[API /users/update-status] Permission denied: User '${adminUsername}' is not admin.`);
      return NextResponse.json({ error: 'Permission denied: Only admin can manage user accounts.' }, { status: 403 });
  }
   // Validate admin's password (don't need branch check for admin)
   console.log('[API /users/update-status] Validating admin credentials...');
   const adminValidation = await validateUser(adminUsername, adminPassword);
   if (!adminValidation.valid) {
        console.log('[API /users/update-status] Admin validation failed:', adminValidation.reason);
       return NextResponse.json({ error: `Admin authentication failed: ${adminValidation.reason}` }, { status: 403 });
   }
   console.log('[API /users/update-status] Admin validated successfully.');

  // Prevent admin from modifying themselves
  if (targetUsername === 'admin') {
      console.log('[API /users/update-status] Action blocked: Cannot modify primary admin account.');
    return NextResponse.json({ error: 'Cannot modify the primary admin account via this method.' }, { status: 400 });
  }

  // --- Database Interaction --- 
  try {
    const updates: string[] = [];
    const queryParams: (string | boolean | string[])[] = [];
    let paramIndex = 1; // Start parameter index at 1
    let messages: string[] = [];
    let isDeleteAction = false;

    // Handle Activate/Deactivate
    if (action === 'activate') {
      updates.push(`active = $${paramIndex++}`);
      queryParams.push(true);
      messages.push('activated');
    } else if (action === 'deactivate') {
      updates.push(`active = $${paramIndex++}`);
      queryParams.push(false);
      messages.push('deactivated');
    }

    // Handle Branch Permissions Update (only if field was present and valid)
    if (hasValidPermissionsArray) {
      // Ensure permissions is an array of strings
      const sanitizedPermissions = branch_permissions.filter((p): p is string => typeof p === 'string');
      updates.push(`branch_permissions = $${paramIndex++}`); 
      queryParams.push(sanitizedPermissions); // Pass array directly for TEXT[] type
      messages.push('permissions updated');
      if (action !== 'update_perms' && hasValidAction) {
          // If combined with activate/deactivate, message is already set
      } else if (!hasValidAction) {
         // If ONLY permissions are being updated, set the message
         // messages.push('permissions updated'); // Already done above
      }
    }

    let queryText = '';
    if (action === 'delete') {
      // --- Delete User --- 
      console.log(`[API /users/update-status] Preparing to delete user: ${targetUsername}`);
      queryText = 'DELETE FROM users WHERE username = $1';
      queryParams.splice(0, queryParams.length, targetUsername); // Replace params with just username
      messages = ['deleted']; 
      isDeleteAction = true;
    } else if (updates.length > 0) {
      // --- Update User --- 
      console.log(`[API /users/update-status] Preparing to update user: ${targetUsername} with actions: ${messages.join(', ')}`);
      // Add updated_at timestamp update
      updates.push(`updated_at = CURRENT_TIMESTAMP`); 
      queryText = `UPDATE users SET ${updates.join(', ')} WHERE username = $${paramIndex}`; // WHERE clause uses the next index
      queryParams.push(targetUsername); // Add username as the last parameter
    } else {
        // This case should be caught by initial validation, but as a safeguard:
       console.log('[API /users/update-status] Error: No valid update action determined despite passing initial checks.');
       return NextResponse.json({ error: 'No valid update action specified.' }, { status: 400 });
    }

     console.log(`[API /users/update-status] Executing Query: ${queryText.substring(0,100)}... with ${queryParams.length} Params`);
     const result = await query(queryText, queryParams);

    if (result.rowCount === 0 && !isDeleteAction) {
        console.log(`[API /users/update-status] Target user not found: ${targetUsername}`);
        return NextResponse.json({ error: `Target user '${targetUsername}' not found.` }, { status: 404 });
    } else if (isDeleteAction && result.rowCount === 0) {
         // If delete was requested but user not found, it's effectively a success from the client's perspective
         console.log(`[API /users/update-status] User '${targetUsername}' not found for deletion, considered successful.`);
         messages = ['not found/deleted']; 
    } else {
         console.log(`[API /users/update-status] Database operation successful for ${targetUsername}. Rows affected: ${result.rowCount}`);
    }

    return NextResponse.json({ 
        success: true, 
        message: `User '${targetUsername}' successfully ${messages.join(' and ')}.` 
    });

  } catch (error: unknown) {
    console.error(`[API /users/update-status] Error processing request for user '${targetUsername}':`, error);
    let message = 'Database error during user account update.';
    if (error instanceof Error) {
        message = error.message;
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
} 