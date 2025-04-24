import { NextResponse } from 'next/server';
import axios from 'axios';
import { 
    GITHUB_API_BASE, 
    GITHUB_OWNER, 
    GITHUB_REPO, 
    githubAuthHeaders, 
    createTagReference 
} from '@/lib/server/github'; // Adjust path as needed
import { validateUser } from '@/lib/server/auth'; // Adjust path as needed
import { getLatestSemanticTag, incrementVersion } from '@/lib/server/utils'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * POST /api/github/commit-file
 * Commits a file change and handles version tagging.
 */
export async function POST(request: Request) {
  console.log('[API /github/commit-file] Received request');
  let body;
  try {
    body = await request.json();
     console.log('[API /github/commit-file] Request body parsed:', { 
         user: body?.username, 
         path: body?.path, 
         branch: body?.branch, 
         bump: body?.versionBumpType, 
         hasContent: !!body?.content 
     });
  } catch (e) {
    console.error('[API /github/commit-file] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password, path, message, content, branch, versionBumpType } = body;

  // Validate required fields
  if (!username || !password || !path || !message || typeof content !== 'string' || !branch || 
      !versionBumpType || !['major', 'minor', 'patch'].includes(versionBumpType)) {
    console.log('[API /github/commit-file] Validation failed: Missing fields or invalid bump type.');
    return NextResponse.json({
      error: 'Missing required fields (username, password, path, message, content, branch) or invalid versionBumpType (must be major, minor, or patch)',
    }, { status: 400 });
  }

  // Validate user credentials and branch access
   console.log(`[API /github/commit-file] Validating user ${username} for branch ${branch}...`);
  const validationResult = await validateUser(username, password, branch);
  if (!validationResult.valid) {
      console.log(`[API /github/commit-file] User validation failed: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }
   console.log(`[API /github/commit-file] User ${username} validated.`);

  const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  let commitSha: string | null = null; // To store the SHA of the new commit
  let commitSuccess = false;
  let newCommitData: any = null;

  try {
    // 1. Get current SHA of the file (if it exists) for the update
    let currentSha: string | null = null;
    try {
      console.log(`[API /github/commit-file] Checking existing file SHA: ${path} on ${branch}`);
      const getResp = await axios.get(`${url}?ref=${encodeURIComponent(branch)}`, { headers: githubAuthHeaders });
      currentSha = getResp.data.sha;
      console.log(`[API /github/commit-file] Existing SHA found: ${currentSha}`);
    } catch (err: any) {
      if (err.response?.status === 404) {
         console.log(`[API /github/commit-file] File ${path} not found on ${branch}. Creating new file.`);
      } else {
         console.error(`[API /github/commit-file] Error checking existing file:`, err.response?.data || err.message);
        throw new Error('Failed to check existing file on GitHub.'); // Re-throw other errors
      }
    }

    // 2. Commit the file changes via PUT request
    const payload = {
      message,
      content, // Expecting base64 encoded content from frontend
      branch,
      ...(currentSha ? { sha: currentSha } : {}), // Include SHA only if updating
    };

     console.log(`[API /github/commit-file] Committing file ${path} to ${branch}...`);
    const commitResponse = await axios.put(url, payload, { headers: githubAuthHeaders }); // Use headers here
    commitSha = commitResponse.data?.commit?.sha;
    newCommitData = commitResponse.data?.commit;
    if (!commitSha || !newCommitData) {
        throw new Error('Invalid commit response from GitHub after file PUT.');
    }
    commitSuccess = true;
    console.log(`[API /github/commit-file] File commit successful. SHA: ${commitSha}`);

    // 3. Handle Tagging (only if commit succeeded)
    let newTagName: string | null = null;
    let tagResult: { success: boolean; error?: string } = { success: false, error: 'Tagging skipped or failed.' };

    try {
      // Fetch existing tags
      const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
      console.log('[API /github/commit-file] Fetching existing tags...');
      const tagsResponse = await axios.get(tagsUrl, { headers: githubAuthHeaders });
      const latestTag = getLatestSemanticTag(tagsResponse.data); 
      console.log(`[API /github/commit-file] Latest tag found: ${latestTag || 'None'}`);
      
      // Calculate next version
      newTagName = incrementVersion(latestTag, versionBumpType);
      console.log(`[API /github/commit-file] Calculated next tag: ${newTagName}`);

      // Create the new tag reference pointing to the commit we just made
      if (newTagName && commitSha) {
        tagResult = await createTagReference(newTagName, commitSha); // Use helper
      } else {
        tagResult.error = 'Could not calculate new tag name or missing commit SHA.';
      }
    } catch (tagLookupError: any) {
      console.error('[API /github/commit-file] Error during tag lookup/calculation:', tagLookupError.message);
      tagResult.error = 'Error processing existing tags.';
      // Proceed without tagging, response handled below
    }

    // 4. Respond based on commit and tag results
    if (tagResult.success) {
        console.log(`[API /github/commit-file] Commit and tagging successful (${newTagName}).`);
        return NextResponse.json({ 
            success: true, 
            message: `File committed successfully and tagged as ${newTagName}.`, 
            commit: newCommitData, 
            tag: newTagName 
        });
    } else {
        console.log(`[API /github/commit-file] Commit successful, but tagging failed: ${tagResult.error}`);
        // Commit succeeded, but tagging failed - return 207 Multi-Status
        return NextResponse.json({ 
            success: true, // Commit was successful
            message: `File committed successfully, but failed to create tag ${newTagName || ''}. Reason: ${tagResult.error}`, 
            commit: newCommitData,
            tagError: tagResult.error,
        }, { status: 207 }); 
    }

  } catch (error: any) {
    console.error('[API /github/commit-file] Error during file commit process:', error?.response?.data || error.message);
    const status = error.response?.status || 500;
    const errorMessage = error.response?.data?.message || 'Failed to commit file to GitHub.';
    // Provide more specific feedback for common issues like conflicts
     if (status === 409 || (status === 422 && error.response?.data?.message?.includes('sha'))) {
        return NextResponse.json({ error: 'Conflict: File may have been updated by someone else. Please refresh and try again.' }, { status: 409 });
     }
    return NextResponse.json({ error: errorMessage }, { status });
  }
} 