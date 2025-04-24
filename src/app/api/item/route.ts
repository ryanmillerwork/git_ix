import { NextResponse } from 'next/server';
import axios from 'axios';
import { 
    GITHUB_API_BASE, 
    GITHUB_OWNER, 
    GITHUB_REPO, 
    githubAuthHeaders, 
    createTagReference, 
    getTree, 
    createTree, 
    getBranchHeadSha, 
    getCommitTreeSha 
} from '@/lib/server/github'; // Adjust path as needed
import { validateUser } from '@/lib/server/auth'; // Adjust path as needed
import { getLatestSemanticTag, incrementVersion, hasUnsafePathSegments } from '@/lib/server/utils'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * DELETE /api/item
 * Deletes a file or folder using Git Data API, applies patch tag.
 * Expects data in the request body.
 */
export async function DELETE(request: Request) {
  console.log('[API /item DELETE] Received request');
  let body;
  try {
    body = await request.json();
    console.log('[API /item DELETE] Request body parsed:', { 
        user: body?.username, 
        branch: body?.branch, 
        path: body?.path, 
    });
  } catch (e) {
    console.error('[API /item DELETE] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password, branch, path, message } = body;
  const commitMessage = message || `Delete item: ${path}`; // Default message

  // --- Validation ---
  if (!username || !password || !branch || !path || !commitMessage) { // Ensure message is present
     console.log('[API /item DELETE] Validation failed: Missing required fields.');
    return NextResponse.json({ error: 'Missing required fields: username, password, branch, path, message' }, { status: 400 });
  }
  if (hasUnsafePathSegments(path) || path === '/' || path === '') {
       console.log('[API /item DELETE] Validation failed: Invalid path.');
     return NextResponse.json({ error: 'Invalid or potentially unsafe path for deletion.' }, { status: 400 });
  }

  // Validate user credentials and branch access
   console.log(`[API /item DELETE] Validating user ${username} for branch ${branch}...`);
  const validationResult = await validateUser(username, password, branch);
  if (!validationResult.valid) {
       console.log(`[API /item DELETE] User validation failed: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }
   console.log(`[API /item DELETE] User ${username} validated.`);

  // --- GitHub API Interaction (Git Data API - Level-by-Level) ---
  try {
    // 1. Get latest commit and root tree SHA
    const latestCommitSha = await getBranchHeadSha(branch);
    const rootTreeSha = await getCommitTreeSha(latestCommitSha);

    // 2. Split path and prepare for traversal
    const pathSegments = path.split('/').filter(Boolean);
    const itemName = pathSegments.pop(); // Item to delete
    const parentPathSegments = pathSegments; // Path to the parent directory
    
    if (!itemName) {
         console.log('[API /item DELETE] Invalid path provided (no item name).');
         return NextResponse.json({ error: 'Invalid path provided.' }, { status: 400 });
    }

    let currentTreeSha = rootTreeSha;
    const treeShas = [rootTreeSha]; // Store SHAs as we go down

    // 3. Traverse down to the parent directory
    console.log(`[API /item DELETE] Traversing path segments: ${parentPathSegments.join('/')}`);
    for (const segment of parentPathSegments) {
        const currentTreeContent = await getTree(currentTreeSha); // Non-recursive
        const entry = currentTreeContent.find(item => item.path === segment && item.type === 'tree');
        if (!entry) {
            console.log(`[API /item DELETE] Path segment '${segment}' not found or not a tree in SHA: ${currentTreeSha}`);
            return NextResponse.json({ error: `Path not found: Could not find directory '${segment}'.` }, { status: 404 });
        }
        currentTreeSha = entry.sha;
        treeShas.push(currentTreeSha);
        console.log(`[API /item DELETE] Found segment '${segment}', next tree SHA: ${currentTreeSha}`);
    }
    
    const parentTreeSha = currentTreeSha; // SHA of the immediate parent directory
    console.log(`[API /item DELETE] Parent directory tree SHA: ${parentTreeSha}`);

    // 4. Modify the parent tree (remove the target item)
    const parentTreeContent = await getTree(parentTreeSha);
    const originalParentSize = parentTreeContent.length;
    const newParentTreeDefinition = parentTreeContent
        .filter(item => item.path !== itemName)
        .map(item => ({ path: item.path, mode: item.mode, type: item.type, sha: item.sha }));
    
    if (newParentTreeDefinition.length === originalParentSize) {
        // Item wasn't actually in the parent directory listing
        console.log(`[API /item DELETE] Item '${itemName}' not found in parent tree SHA: ${parentTreeSha}`);
            return NextResponse.json({ error: `Item '${itemName}' not found in directory '${parentPathSegments.join('/')|| '/'}'.` }, { status: 404 });
    }

    console.log(`[API /item DELETE] Creating new parent tree definition (size ${newParentTreeDefinition.length})`);
    let newLowerTreeSha = await createTree(newParentTreeDefinition);

    // 5. Propagate changes back up the tree
    for (let i = parentPathSegments.length - 1; i >= 0; i--) {
        const segmentNameToUpdate = parentPathSegments[i];
        const currentLevelTreeSha = treeShas[i];
        
        console.log(`[API /item DELETE] Propagating change: Updating entry '${segmentNameToUpdate}' in tree ${currentLevelTreeSha} to point to ${newLowerTreeSha}`);
        
        const currentLevelContent = await getTree(currentLevelTreeSha);
        const newLevelDefinition = currentLevelContent.map(item => {
            if (item.path === segmentNameToUpdate && item.type === 'tree') {
                return { path: item.path, mode: item.mode, type: item.type, sha: newLowerTreeSha };
            }
            return { path: item.path, mode: item.mode, type: item.type, sha: item.sha };
        });

        newLowerTreeSha = await createTree(newLevelDefinition);
    }
    
    const newRootTreeSha = newLowerTreeSha;
    console.log(`[API /item DELETE] New root tree SHA: ${newRootTreeSha}`);
    
    if (newRootTreeSha === rootTreeSha) {
         console.error(`[API /item DELETE] Error: Root tree SHA did not change after propagation.`);
         return NextResponse.json({ error: 'Internal server error: Failed to update tree structure correctly.' }, { status: 500 });
    }

    // 6. Create the commit
    console.log(`[API /item DELETE] Creating final commit object...`);
    const createCommitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`;
    const finalCommitMessage = `${commitMessage} [author: ${username}]`;
    const createCommitPayload = {
        message: finalCommitMessage,
        tree: newRootTreeSha,
        parents: [latestCommitSha],
    };
    const createCommitResponse = await axios.post(createCommitUrl, createCommitPayload, { headers: githubAuthHeaders });
    const newCommitSha = createCommitResponse.data?.sha;
    if (!newCommitSha) {
        throw new Error('Failed to create commit or extract SHA after delete.');
    }
    console.log(`[API /item DELETE] New commit SHA: ${newCommitSha}`);

    // 7. Auto Tagging (Patch Bump)
    let newTagName: string | null = null;
    let tagResult: { success: boolean; error?: string } = { success: false, error: 'Tagging skipped or failed.' };
    try {
        const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
        console.log('[API /item DELETE] Fetching existing tags for auto-bump...');
        const tagsResponse = await axios.get(tagsUrl, { headers: githubAuthHeaders });
        const latestTag = getLatestSemanticTag(tagsResponse.data);
        console.log(`[API /item DELETE] Latest tag found: ${latestTag || 'None'}`);
        newTagName = incrementVersion(latestTag, 'patch'); // Force patch bump
        console.log(`[API /item DELETE] Calculated next tag (patch): ${newTagName}`);

        if (newTagName && newCommitSha) {
            tagResult = await createTagReference(newTagName, newCommitSha); // Tag the NEW commit
        } else {
            tagResult.error = 'Could not calculate new tag name.';
        }
    } catch (tagLookupError: any) {
        console.error('[API /item DELETE] Error during tag lookup/calculation:', tagLookupError.message);
        tagResult.error = 'Error processing existing tags.';
    }
    // --- End Auto Tagging ---

    // 8. Update branch reference
    console.log(`[API /item DELETE] Updating branch reference '${branch}' to ${newCommitSha}`);
    const updateRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branch}`;
    await axios.patch(updateRefUrl, { sha: newCommitSha }, { headers: githubAuthHeaders });
    console.log(`[API /item DELETE] Branch '${branch}' updated successfully.`);

    // 9. Construct Response
    let finalMessage = `Item at path '${path}' deleted successfully.`;
    let finalStatus = 200;
    if (tagResult.success) {
        finalMessage += ` New state tagged as ${newTagName}.`;
    } else {
        finalMessage += ` Failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
        finalStatus = 207; // Partial success
    }
    console.log(`[API /item DELETE] Update complete. Final status: ${finalStatus}`);

    return NextResponse.json({ 
        success: true, // Delete operation succeeded before tagging
        message: finalMessage, 
        commit: createCommitResponse.data, 
        ...(tagResult.success && { tag: newTagName }),
        ...(tagResult.error && { tagError: tagResult.error })
    }, { status: finalStatus });

  } catch (error: any) {
    console.error(`[API /item DELETE] Error deleting path '${path}' on branch '${branch}':`, error);
    const status = error.response?.status || (error.message?.includes('fetch tree data') ? 404 : 500);
    const errorMessage = error.response?.data?.message || error.message || 'An unexpected error occurred during deletion.';
    return NextResponse.json({ error: errorMessage }, { status });
  }
} 