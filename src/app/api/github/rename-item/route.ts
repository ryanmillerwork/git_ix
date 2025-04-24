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
import { getLatestSemanticTag, incrementVersion, hasInvalidNameChars, hasUnsafePathSegments } from '@/lib/server/utils'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * POST /api/github/rename-item
 * Renames a file or folder within the same branch using Git Data API, applies patch tag.
 */
export async function POST(request: Request) {
  console.log('[API /github/rename-item] Received request');
  let body;
  try {
    body = await request.json();
     console.log('[API /github/rename-item] Request body parsed:', { 
         user: body?.username, 
         branch: body?.branch, 
         originalPath: body?.originalPath, 
         newName: body?.newName 
     });
  } catch (e) {
    console.error('[API /github/rename-item] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password, branch, originalPath, newName } = body;

  // --- Basic Validation ---
  if (!username || !password || !branch || !originalPath || !newName) {
      console.log('[API /github/rename-item] Validation failed: Missing required fields.');
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
  }
  if (hasInvalidNameChars(newName) || !newName.trim()) {
      console.log('[API /github/rename-item] Validation failed: Invalid new name.');
    return NextResponse.json({ error: 'Invalid new name.' }, { status: 400 });
  }
  if (hasUnsafePathSegments(originalPath) || originalPath === '/' || !originalPath) {
       console.log('[API /github/rename-item] Validation failed: Invalid original path.');
     return NextResponse.json({ error: 'Invalid original path.' }, { status: 400 });
  }

  const pathSegments = originalPath.split('/').filter(Boolean);
  const originalName = pathSegments.pop(); // Item name to rename
  const parentPathSegments = pathSegments; // Path to the parent directory
  const parentPath = parentPathSegments.join('/'); // String representation
  const newPath = parentPath ? `${parentPath}/${newName}` : newName; // Construct full new path

  if (!originalName) {
      console.log('[API /github/rename-item] Validation failed: Could not determine original name from path.');
    return NextResponse.json({ error: 'Invalid original path provided.' }, { status: 400 });
  }
  if (originalPath === newPath) {
      console.log('[API /github/rename-item] Validation failed: New name is same as original.');
     return NextResponse.json({ error: 'New name cannot be the same as the original name.' }, { status: 400 });
  }

  // Validate user credentials and branch access
   console.log(`[API /github/rename-item] Validating user ${username} for branch ${branch}...`);
  const validationResult = await validateUser(username, password, branch);
  if (!validationResult.valid) {
      console.log(`[API /github/rename-item] User validation failed: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }
   console.log(`[API /github/rename-item] User ${username} validated.`);

  // --- GitHub API Interaction (Git Data API) ---
  const commitMessage = `Rename ${originalPath} to ${newPath} [author: ${username}]`;

  try {
    // 1. Get latest commit and root tree SHA
    const latestCommitSha = await getBranchHeadSha(branch);
    const rootTreeSha = await getCommitTreeSha(latestCommitSha);

    // 2. Traverse down to the parent directory, getting tree SHAs along the way
    let currentTreeSha = rootTreeSha;
    const treeShas = [rootTreeSha]; // Store SHAs for propagation

    console.log(`[API /github/rename-item] Traversing path segments to parent: ${parentPath}`);
    for (const segment of parentPathSegments) {
      const currentTreeContent = await getTree(currentTreeSha); // Non-recursive fetch
      const entry = currentTreeContent.find(item => item.path === segment && item.type === 'tree');
      if (!entry) {
        console.log(`[API /github/rename-item] Path segment '${segment}' not found or not a tree in SHA: ${currentTreeSha}`);
        return NextResponse.json({ error: `Path not found: Could not find directory '${segment}'.` }, { status: 404 });
      }
      currentTreeSha = entry.sha;
      treeShas.push(currentTreeSha);
      console.log(`[API /github/rename-item] Found segment '${segment}', next tree SHA: ${currentTreeSha}`);
    }

    const parentTreeSha = currentTreeSha; // SHA of the immediate parent directory
    console.log(`[API /github/rename-item] Parent directory tree SHA: ${parentTreeSha}`);

    // 3. Modify the parent tree: remove old name, add new name with old SHA
    const parentTreeContent = await getTree(parentTreeSha); // Non-recursive

    // Find the item to rename
    const itemToRename = parentTreeContent.find(item => item.path === originalName);
    if (!itemToRename) {
      console.log(`[API /github/rename-item] Item '${originalName}' not found in parent tree SHA: ${parentTreeSha}`);
      return NextResponse.json({ error: `Item '${originalName}' not found in directory '${parentPath || '/'}'.` }, { status: 404 });
    }
    console.log(`[API /github/rename-item] Found item to rename: ${originalName} (Type: ${itemToRename.type}, SHA: ${itemToRename.sha})`);

    // Check if new name already exists
    const newItemExists = parentTreeContent.some(item => item.path === newName);
    if (newItemExists) {
      console.log(`[API /github/rename-item] Conflict: '${newName}' already exists in parent tree SHA: ${parentTreeSha}`);
      return NextResponse.json({ error: `An item named '${newName}' already exists in directory '${parentPath || '/'}'.` }, { status: 409 }); // 409 Conflict
    }

    // Create the new parent tree definition
    const newParentTreeDefinition = parentTreeContent
      .filter(item => item.path !== originalName) // Remove original
      .map(item => ({ path: item.path, mode: item.mode, type: item.type, sha: item.sha })); // Map existing
    
    // Add the renamed item pointing to the original content SHA
    newParentTreeDefinition.push({
      path: newName,
      mode: itemToRename.mode,
      type: itemToRename.type,
      sha: itemToRename.sha, // Point to original blob/tree SHA
    });

    console.log(`[API /github/rename-item] Creating new parent tree definition (size ${newParentTreeDefinition.length})`);
    let newLowerTreeSha = await createTree(newParentTreeDefinition);

    // 4. Propagate changes back up the tree
    for (let i = parentPathSegments.length - 1; i >= 0; i--) {
      const segmentNameToUpdate = parentPathSegments[i];
      const currentLevelTreeSha = treeShas[i]; // Tree *containing* the entry we need to update

      console.log(`[API /github/rename-item] Propagating change: Updating entry '${segmentNameToUpdate}' in tree ${currentLevelTreeSha} to point to ${newLowerTreeSha}`);

      const currentLevelContent = await getTree(currentLevelTreeSha);
      const newLevelDefinition = currentLevelContent.map(item => {
        if (item.path === segmentNameToUpdate && item.type === 'tree') {
          // Update SHA for the directory entry we modified below
          return { path: item.path, mode: item.mode, type: item.type, sha: newLowerTreeSha };
        }
        // Keep other items the same
        return { path: item.path, mode: item.mode, type: item.type, sha: item.sha };
      });

      newLowerTreeSha = await createTree(newLevelDefinition);
    }

    const newRootTreeSha = newLowerTreeSha; // After loop, this holds the new root tree SHA
    console.log(`[API /github/rename-item] New root tree SHA: ${newRootTreeSha}`);

    if (newRootTreeSha === rootTreeSha) {
      console.warn(`[API /github/rename-item] Warning: Root tree SHA did not change after rename operation. Proceeding...`);
      // Allow this, could be case-only rename or GitHub optimization
    }

    // 5. Create the commit
    console.log(`[API /github/rename-item] Creating final commit object...`);
    const createCommitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`;
    const createCommitPayload = {
      message: commitMessage,
      tree: newRootTreeSha,
      parents: [latestCommitSha],
    };
    const createCommitResponse = await axios.post(createCommitUrl, createCommitPayload, { headers: githubAuthHeaders });
    const newCommitSha = createCommitResponse.data?.sha;
     if (!newCommitSha) {
        throw new Error('Failed to create commit or extract SHA after rename.');
    }
    console.log(`[API /github/rename-item] New commit SHA: ${newCommitSha}`);

    // 6. Auto Tagging (Patch Bump)
    let newTagName: string | null = null;
    let tagResult: { success: boolean; error?: string } = { success: false, error: 'Tagging skipped or failed.' };
    try {
      const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
      const tagsResponse = await axios.get(tagsUrl, { headers: githubAuthHeaders });
      const latestTag = getLatestSemanticTag(tagsResponse.data);
      newTagName = incrementVersion(latestTag, 'patch');
       console.log(`[API /github/rename-item] Calculated next tag: ${newTagName}`);
      if (newTagName && newCommitSha) {
        tagResult = await createTagReference(newTagName, newCommitSha);
      } else { tagResult.error = 'Could not calculate new tag name or missing commit SHA.'; }
    } catch (tagLookupError: unknown) {
      let message = 'Error processing existing tags.';
      if (tagLookupError instanceof Error) {
          message = tagLookupError.message;
          console.error('[API /github/rename-item] Error during tag lookup/calculation:', message);
      } else if (axios.isAxiosError(tagLookupError)) {
          message = tagLookupError.response?.data?.message || tagLookupError.message || message;
          console.error('[API /github/rename-item] Axios Error during tag lookup/calculation:', message);
      } else {
          console.error('[API /github/rename-item] Unknown error during tag lookup/calculation:', tagLookupError);
      }
      tagResult.error = message;
    }

    // 7. Update branch reference
    console.log(`[API /github/rename-item] Updating branch reference '${branch}' to ${newCommitSha}`);
    const updateRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branch}`;
    await axios.patch(updateRefUrl, { sha: newCommitSha }, { headers: githubAuthHeaders });
    console.log(`[API /github/rename-item] Branch '${branch}' updated successfully.`);

    // 8. Construct Response
    let finalMessage = `Item renamed to '${newPath}' successfully.`;
    let finalStatus = 200;
    if (tagResult.success) {
      finalMessage += ` New state tagged as ${newTagName}.`;
    } else {
      finalMessage += ` Failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
      finalStatus = 207; // Partial success
    }

     console.log(`[API /github/rename-item] Responding with status: ${finalStatus}`);
    return NextResponse.json({
      success: true, // Rename operation succeeded before tagging
      message: finalMessage,
      commit: createCommitResponse.data, // Send back commit info
      ...(tagResult.success && { tag: newTagName }),
      ...(tagResult.error && { tagError: tagResult.error })
    }, { status: finalStatus });

  } catch (err: unknown) {
    // Default error response
    let status = 500;
    let errorMessage = 'An unexpected error occurred during rename.';

    if (axios.isAxiosError(err)) {
      // AxiosError: safely pull out HTTP status & body message
      status = err.response?.status ?? 500;
      const respData = err.response?.data as { message?: string } | undefined;
      errorMessage = respData?.message ?? err.message;
      console.error(
        `[API /github/rename-item] AxiosError renaming '${originalPath}' → '${newPath}':`,
        errorMessage
      );

      // Map specific GitHub statuses to more user-friendly text
      if (status === 404) {
        errorMessage = `Original path or intermediate directory not found: ${originalPath}`;
      } else if (status === 409) {
        errorMessage = `Conflict: an item named '${newName}' already exists in '${parentPath || '/'}'.`;
      }

    } else if (err instanceof Error) {
      // Plain JS Error
      errorMessage = err.message;
      console.error(
        `[API /github/rename-item] Error renaming '${originalPath}' → '${newPath}':`,
        errorMessage
      );
    } else {
      // Something truly unexpected (string, object, etc.)
      console.error(
        `[API /github/rename-item] Unknown non-Error throw renaming '${originalPath}' → '${newPath}':`,
        err
      );
    }

    return NextResponse.json(
      { error: errorMessage },
      { status }
    );
  }
} 