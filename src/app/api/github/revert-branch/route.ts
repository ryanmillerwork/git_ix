import { NextResponse } from 'next/server';
import axios from 'axios';
import { 
    GITHUB_API_BASE, 
    GITHUB_OWNER, 
    GITHUB_REPO, 
    githubAuthHeaders, 
    createTagReference, 
    getBranchHeadSha, 
    getCommitTreeSha 
} from '@/lib/server/github'; // Adjust path as needed
import { validateUser } from '@/lib/server/auth'; // Adjust path as needed
import { getLatestSemanticTag, incrementVersion } from '@/lib/server/utils'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * POST /api/github/revert-branch
 * Creates a new commit reflecting the state of an old commit, applies patch tag.
 */
export async function POST(request: Request) {
  console.log('[API /github/revert-branch] Received request');
  let body;
  try {
    body = await request.json();
    console.log('[API /github/revert-branch] Request body parsed:', { 
        user: body?.username, 
        branch: body?.branchToRevert, 
        commit: body?.commitShaToRevertTo 
    });
  } catch (e) {
    console.error('[API /github/revert-branch] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password, branchToRevert, commitShaToRevertTo, message } = body;
  const commitMessage = message || `Revert branch '${branchToRevert}' to state of commit ${commitShaToRevertTo.substring(0, 7)}`;

  // --- Validation ---
  if (!username || !password || !branchToRevert || !commitShaToRevertTo) {
      console.log('[API /github/revert-branch] Validation failed: Missing required fields.');
    return NextResponse.json({ error: 'Missing required fields: username, password, branchToRevert, commitShaToRevertTo' }, { status: 400 });
  }
  if (branchToRevert === 'main') {
       console.log('[API /github/revert-branch] Action blocked: Cannot revert main branch.');
       return NextResponse.json({ error: 'Cannot revert the main branch via this method.' }, { status: 400 });
  }

  // Validate user credentials and branch access for the branch being reverted
   console.log(`[API /github/revert-branch] Validating user ${username} for branch ${branchToRevert}...`);
  const validationResult = await validateUser(username, password, branchToRevert);
  if (!validationResult.valid) {
       console.log(`[API /github/revert-branch] User validation failed: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }
   console.log(`[API /github/revert-branch] User ${username} validated for branch ${branchToRevert}.`);

  // --- GitHub API Interaction ---
  try {
    // 1. Get Source Commit Tree SHA (the tree state we want to revert *to*)
    const sourceTreeSha = await getCommitTreeSha(commitShaToRevertTo);
    console.log(`[API /github/revert-branch] Source tree SHA: ${sourceTreeSha}`);

    // 2. Get the current HEAD commit of the target branch (to use as parent)
    const currentHeadSha = await getBranchHeadSha(branchToRevert);
    console.log(`[API /github/revert-branch] Current HEAD SHA: ${currentHeadSha}`);

    // 3. Create the New Commit Object pointing to the source tree
    console.log(`[API /github/revert-branch] Creating new commit object...`);
    const createCommitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`;
    const finalCommitMessage = `${commitMessage} [author: ${username}]`; // Append author
    const newCommitPayload = {
      message: finalCommitMessage,
      tree: sourceTreeSha,      // Point to the source commit's existing tree
      parents: [currentHeadSha] // Set parent to the current HEAD
    };
    const createCommitResponse = await axios.post(createCommitUrl, newCommitPayload, { headers: githubAuthHeaders });
    const newCommitSha = createCommitResponse.data?.sha;
    if (!newCommitSha) {
        throw new Error('Failed to create new commit object or extract SHA.');
    }
    console.log(`[API /github/revert-branch] New commit created SHA: ${newCommitSha}`);

    // 4. Auto Tagging (Patch Bump)
    let newTagName: string | null = null;
    let tagResult: { success: boolean; error?: string } = { success: false, error: 'Tagging skipped or failed.' };
    try {
        const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
        console.log('[API /github/revert-branch] Fetching existing tags for auto-bump...');
        const tagsResponse = await axios.get(tagsUrl, { headers: githubAuthHeaders });
        const latestTag = getLatestSemanticTag(tagsResponse.data);
        console.log(`[API /github/revert-branch] Latest tag found: ${latestTag || 'None'}`);
        newTagName = incrementVersion(latestTag, 'patch'); // Force patch bump
        console.log(`[API /github/revert-branch] Calculated next tag (patch): ${newTagName}`);

        if (newTagName && newCommitSha) {
            tagResult = await createTagReference(newTagName, newCommitSha); // Tag the NEW commit
        } else {
            tagResult.error = 'Could not calculate new tag name.';
        }
    } catch (tagLookupError: any) {
        console.error('[API /github/revert-branch] Error during tag lookup/calculation:', tagLookupError.message);
        tagResult.error = 'Error processing existing tags.';
    }
    // --- End Auto Tagging ---

    // 5. Update the Branch Reference (fast-forward)
    console.log(`[API /github/revert-branch] Updating branch reference ${branchToRevert} to point to ${newCommitSha}`);
    const updateRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branchToRevert}`;
    const updateRefPayload = {
      sha: newCommitSha,
      force: false // Should typically be a fast-forward
    };
    await axios.patch(updateRefUrl, updateRefPayload, { headers: githubAuthHeaders });
    console.log(`[API /github/revert-branch] Branch reference updated.`);

    // 6. Adjust final message based on tagging success
    let finalMessage = `Branch '${branchToRevert}' reverted to state of commit ${commitShaToRevertTo.substring(0, 7)}.`;
    let finalStatus = 200;

    if (tagResult.success) {
        finalMessage += ` New state tagged as ${newTagName}.`;
         console.log(`[API /github/revert-branch] Revert and tagging successful.`);
    } else {
        finalMessage += ` Failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
        finalStatus = 207; // Partial success
         console.log(`[API /github/revert-branch] Revert successful, but tagging failed.`);
    }

    return NextResponse.json({ 
        success: true, // Revert commit + branch update succeeded
        message: finalMessage, 
        commit: createCommitResponse.data, // Return new commit info
        ...(tagResult.success && { tag: newTagName }),
        ...(tagResult.error && { tagError: tagResult.error })
    }, { status: finalStatus });

  } catch (error: any) {
    console.error(`[API /github/revert-branch] Error during revert process for branch '${branchToRevert}':`, error.response?.data || error.message);
    // Add specific error checks if needed (e.g., 404 for bad SHAs/branch, 422 for bad parents)
    const status = error.response?.status || 500;
    const errorMessage = error.response?.data?.message || error.message || `Failed to revert branch '${branchToRevert}'. Check server logs.`;
    return NextResponse.json({ error: errorMessage }, { status });
  }
} 