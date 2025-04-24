import { NextResponse } from 'next/server';
import axios from 'axios';
import { 
    GITHUB_API_BASE, 
    GITHUB_OWNER, 
    GITHUB_REPO, 
    githubAuthHeaders, 
    createTagReference, 
    getBranchHeadSha 
} from '@/lib/server/github'; // Adjust path as needed
import { validateUser } from '@/lib/server/auth'; // Adjust path as needed
import { getLatestSemanticTag, incrementVersion } from '@/lib/server/utils'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * POST /api/github/create-branch
 * Creates a new branch from a source branch and applies a patch tag.
 */
export async function POST(request: Request) {
  console.log('[API /github/create-branch] Received request');
  let body;
  try {
    body = await request.json();
    console.log('[API /github/create-branch] Request body parsed:', { 
        user: body?.username, 
        newBranch: body?.newBranchName, 
        sourceBranch: body?.sourceBranch 
    });
  } catch (e) {
    console.error('[API /github/create-branch] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password, newBranchName, sourceBranch } = body;

  // --- Validation --- 
  if (!username || !password || !newBranchName || !sourceBranch) {
    console.log('[API /github/create-branch] Validation failed: Missing required fields.');
    return NextResponse.json({
      error: 'Missing required fields: username, password, newBranchName, sourceBranch',
    }, { status: 400 });
  }

   // Validate user credentials against the SOURCE branch (user needs read access to source)
   console.log(`[API /github/create-branch] Validating user ${username} for source branch ${sourceBranch}...`);
  const validationResult = await validateUser(username, password, sourceBranch); 
  if (!validationResult.valid) {
     console.log(`[API /github/create-branch] User validation failed: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }
   console.log(`[API /github/create-branch] User ${username} validated for source branch.`);

  try {
    // 1. Get the SHA of the source branch HEAD
    const sourceSha = await getBranchHeadSha(sourceBranch); 
    console.log(`[API /github/create-branch] Source SHA: ${sourceSha}`);

    // 2. Create the new branch reference using the Git Refs API
    console.log(`[API /github/create-branch] Creating new branch ref: refs/heads/${newBranchName}`);
    const createRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`;
    const refPayload = {
      ref: `refs/heads/${newBranchName}`,
      sha: sourceSha,
    };
    // We don't strictly need the response data unless debugging
    await axios.post(createRefUrl, refPayload, { headers: githubAuthHeaders }); 
    // The SHA for the tag should be the same as the source branch SHA it points to
    const newBranchShaForTag = sourceSha; 
    console.log(`[API /github/create-branch] Branch '${newBranchName}' created successfully pointing to SHA: ${newBranchShaForTag}`);
    
    // 3. Calculate and Create the new tag (Patch Bump)
    let newTagName: string | null = null;
    let tagResult: { success: boolean; error?: string } = { success: false, error: 'Tagging skipped or failed.' };
    try {
        const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
        console.log('[API /github/create-branch] Fetching existing tags for auto-bump...');
        const tagsResponse = await axios.get(tagsUrl, { headers: githubAuthHeaders });
        const latestTag = getLatestSemanticTag(tagsResponse.data);
        console.log(`[API /github/create-branch] Latest tag found: ${latestTag || 'None'}`);
        newTagName = incrementVersion(latestTag, 'patch'); // Force patch bump
        console.log(`[API /github/create-branch] Calculated next tag (patch): ${newTagName}`);

        if (newTagName && newBranchShaForTag) {
            tagResult = await createTagReference(newTagName, newBranchShaForTag); // Tag the commit the new branch points to
        } else {
            tagResult.error = 'Could not calculate new tag name or missing branch SHA.';
        }
    } catch (tagLookupError: any) {
        console.error('[API /github/create-branch] Error during tag lookup/calculation:', tagLookupError.message);
        tagResult.error = 'Error processing existing tags.';
    }

    // 4. Adjust response based on tag result
    let finalMessage = ``;
    let finalStatus = 201; // Default to 201 Created for successful branch creation

    if (tagResult.success) {
      finalMessage = `Branch '${newBranchName}' created and tagged as ${newTagName}.`;
      finalStatus = 201;
       console.log(`[API /github/create-branch] Branch creation and tagging successful.`);
    } else {
        finalMessage = `Branch '${newBranchName}' created, but failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
        finalStatus = 207; // Partial success
         console.log(`[API /github/create-branch] Branch creation successful, but tagging failed.`);
    }
    
    return NextResponse.json({ 
        success: true, // Branch creation itself succeeded
        message: finalMessage,
        branchName: newBranchName,
        sourceSha: sourceSha,
        ...(tagResult.success && { tag: newTagName }),
        ...(tagResult.error && { tagError: tagResult.error })
    }, { status: finalStatus });

  } catch (error: any) {
      console.error(`[API /github/create-branch] Error creating branch '${newBranchName}' from '${sourceBranch}':`, error.response?.data || error.message);
      // Handle specific GitHub errors
      if (error.response?.status === 422) {
          // Branch likely already exists
          return NextResponse.json({ error: `Failed to create branch. Branch '${newBranchName}' may already exist.` }, { status: 422 });
      } else if (error.response?.status === 404 || error.message?.includes('not found')) {
           // Source branch not found (from getBranchHeadSha helper or direct API call)
          return NextResponse.json({ error: `Source branch '${sourceBranch}' not found.` }, { status: 404 });
      } else {
           // Other unexpected errors
          return NextResponse.json({ error: 'Failed to create branch on GitHub due to an unexpected error.' }, { status: 500 });
      }
  }
} 