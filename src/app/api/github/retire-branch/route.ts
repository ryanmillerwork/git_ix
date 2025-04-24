import { NextResponse } from 'next/server';
import axios from 'axios';
import { 
    GITHUB_API_BASE, 
    GITHUB_OWNER, 
    GITHUB_REPO, 
    githubAuthHeaders, 
    githubAxiosAuth // May need auth object for axios delete
} from '@/lib/server/github'; // Adjust path as needed
import { validateUser } from '@/lib/server/auth'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * POST /api/github/retire-branch
 * Renames a branch by adding -retired suffix (admin only).
 */
export async function POST(request: Request) {
  console.log('[API /github/retire-branch] Received request');
  let body;
  try {
    body = await request.json();
    console.log('[API /github/retire-branch] Request body parsed:', { 
        user: body?.username, 
        branch: body?.branchToRetire 
    });
  } catch (e) {
    console.error('[API /github/retire-branch] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password, branchToRetire } = body;

  // --- Validation --- 
  if (!username || !password || !branchToRetire) {
     console.log('[API /github/retire-branch] Validation failed: Missing required fields.');
    return NextResponse.json({
      error: 'Missing required fields: username, password, branchToRetire',
    }, { status: 400 });
  }

  // Prevent retiring the main branch or already retired branches
  if (branchToRetire === 'main') {
     console.log('[API /github/retire-branch] Action blocked: Cannot retire main branch.');
    return NextResponse.json({ error: 'Cannot retire the main branch.' }, { status: 400 });
  }
  if (branchToRetire.endsWith('-retired')) {
       console.log(`[API /github/retire-branch] Action blocked: Branch '${branchToRetire}' already retired.`);
      return NextResponse.json({ error: `Branch '${branchToRetire}' is already retired.` }, { status: 400 });
  }

  // Enforce admin-only retirement
  if (username !== 'admin') { 
     console.log(`[API /github/retire-branch] Permission denied: User '${username}' is not admin.`);
    return NextResponse.json({ error: 'Only admin can retire branches.'}, { status: 403 });
  }
  
  // Validate admin credentials (no branch check needed for this action)
   console.log('[API /github/retire-branch] Validating admin credentials...');
  const validationResult = await validateUser(username, password);
  if (!validationResult.valid) {
      console.log(`[API /github/retire-branch] Admin validation failed: ${validationResult.reason}`);
    return NextResponse.json({ error: `Admin authentication failed: ${validationResult.reason}` }, { status: 403 });
  }
   console.log('[API /github/retire-branch] Admin validated.');

  // --- GitHub API Interaction --- 
  const retiredBranchName = `${branchToRetire}-retired`;
  const gitRefBase = `refs/heads`;

  try {
    // 1. Get the SHA of the branch to retire
    const branchInfoUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/${gitRefBase}/${branchToRetire}`;
    let sourceSha: string | null = null;
    try {
      console.log(`[API /github/retire-branch] Fetching SHA for branch: ${branchToRetire}`);
      const branchResponse = await axios.get(branchInfoUrl, { headers: githubAuthHeaders });
      sourceSha = branchResponse.data?.object?.sha; // Use object.sha for refs
      if (!sourceSha) {
          throw new Error('Could not extract SHA from branch ref response.');
      }
      console.log(`[API /github/retire-branch] Found SHA: ${sourceSha}`);
    } catch (error: unknown) {
      console.error(`[API /github/retire-branch] Error fetching SHA for ${branchToRetire}:`, error);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
          return NextResponse.json({ error: `Branch '${branchToRetire}' not found.` }, { status: 404 });
      }
      throw new Error(`Error accessing branch info for '${branchToRetire}'.`);
    }

    // 2. Create the new retired branch reference
    const createRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`;
    const createPayload = {
      ref: `${gitRefBase}/${retiredBranchName}`,
      sha: sourceSha,
    };
    console.log(`[API /github/retire-branch] Attempting to create retired ref: ${createPayload.ref}`);
    await axios.post(createRefUrl, createPayload, { headers: githubAuthHeaders });
    console.log(`[API /github/retire-branch] Created retired ref: ${retiredBranchName}`);

    // 3. Delete the original branch reference
    // NOTE: axios.delete might need the `auth` object directly depending on version/config
    const deleteRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/${gitRefBase}/${branchToRetire}`;
    console.log(`[API /github/retire-branch] Attempting to delete original ref: ${gitRefBase}/${branchToRetire}`);
    await axios.delete(deleteRefUrl, { headers: githubAuthHeaders, auth: githubAxiosAuth }); // Pass headers and potentially auth obj
    console.log(`[API /github/retire-branch] Deleted original ref: ${branchToRetire}`);

    console.log(`[API /github/retire-branch] Branch ${branchToRetire} retired successfully.`);
    return NextResponse.json({ 
        success: true, 
        message: `Branch '${branchToRetire}' retired successfully as '${retiredBranchName}'.` 
    });

  } catch (error: unknown) {
    // Handle potential errors during create/delete (e.g., retired branch already exists)
    let status = 500;
    let errorMessage = `Failed to retire branch '${branchToRetire}'. Please check GitHub manually.`;
    if (axios.isAxiosError(error)) {
        const respData = error.response?.data as { message?: string } | undefined;
        errorMessage = respData?.message ?? error.message;
        status = error.response?.status ?? 500;
        console.error(`[API /github/retire-branch] AxiosError retiring branch '${branchToRetire}':`, errorMessage);
        if (status === 422) { // Often means ref already exists or delete failed validation
            errorMessage = `Failed to retire branch '${branchToRetire}'. It might already be retired or there was a conflict.`;
        }
    } else if (error instanceof Error) {
        errorMessage = error.message;
        console.error(`[API /github/retire-branch] Error retiring branch '${branchToRetire}':`, errorMessage);
    } else {
        console.error(`[API /github/retire-branch] Unknown error retiring branch '${branchToRetire}':`, error);
    }
     // Attempt to clean up if retired branch was created but original delete failed?
    // This part can be complex. For now, just return a generic error.
    return NextResponse.json({ error: errorMessage }, { status });
  }
} 