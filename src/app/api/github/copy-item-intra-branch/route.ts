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

// Interface for the commit part of the GitHub API response
// (Ensure this matches or is compatible with the one in add-file)
interface GitHubCommitResponseCommit {
  sha: string;
  node_id: string;
  url: string;
  html_url: string;
  author: { 
    name?: string; 
    email?: string; 
    date?: string; 
    login?: string; 
    id?: number;
  };
  committer: { 
    name?: string; 
    email?: string; 
    date?: string; 
    login?: string; 
    id?: number;
  };
  tree: { sha: string; url: string };
  message: string;
  parents: { sha: string; url: string; html_url?: string }[];
  verification?: { 
    verified: boolean; 
    reason: string; 
    signature: string | null; 
    payload: string | null; 
  };
}

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * POST /api/github/copy-item-intra-branch
 * Copies a file or folder within the same branch, applies patch tag.
 */
export async function POST(request: Request) {
  console.log('[API /github/copy-item-intra-branch] Received request');
  let body;
  try {
    body = await request.json();
     console.log('[API /github/copy-item-intra-branch] Request body parsed:', { 
         user: body?.username, 
         branch: body?.branch, 
         source: body?.sourcePath, 
         dest: body?.destinationPath, 
         newName: body?.newName 
     });
  } catch (e) {
    console.error('[API /github/copy-item-intra-branch] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password, branch, sourcePath, destinationPath, newName } = body;
  const fullNewPath = `${destinationPath}/${newName}`;

  // --- Validation ---
  if (!username || !password || !branch || !sourcePath || !destinationPath || !newName) {
       console.log('[API /github/copy-item-intra-branch] Validation failed: Missing required fields.');
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
  }
  if (hasInvalidNameChars(newName) || hasUnsafePathSegments(destinationPath) || hasUnsafePathSegments(sourcePath)) {
       console.log('[API /github/copy-item-intra-branch] Validation failed: Invalid characters or path segments.');
    return NextResponse.json({ error: 'Invalid characters or navigation in names/paths.' }, { status: 400 });
  }
  // Prevent copying into self
  if (sourcePath === fullNewPath || fullNewPath.startsWith(`${sourcePath}/`)) {
      console.log('[API /github/copy-item-intra-branch] Validation failed: Cannot copy item into itself.');
     return NextResponse.json({ error: 'Cannot copy an item into itself.' }, { status: 400 });
  }

  // Validate user credentials and branch access
   console.log(`[API /github/copy-item-intra-branch] Validating user ${username} for branch ${branch}...`);
  const validationResult = await validateUser(username, password, branch);
  if (!validationResult.valid) {
       console.log(`[API /github/copy-item-intra-branch] User validation failed: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }
   console.log(`[API /github/copy-item-intra-branch] User ${username} validated.`);

  // --- GitHub API Interaction ---
  const commitMessage = `Copy ${sourcePath} to ${fullNewPath} [author: ${username}]`;

  try {
    // 1. Determine if source is file or folder
    console.log(`[API /github/copy-item-intra-branch] Checking source item type: ${sourcePath}`);
    const sourceContentsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(sourcePath)}?ref=${encodeURIComponent(branch)}`;
    let sourceItemData;
    try {
      const sourceResponse = await axios.get(sourceContentsUrl, { headers: githubAuthHeaders });
      sourceItemData = sourceResponse.data;
    } catch (error: unknown) {
      // Use type guards
      if (axios.isAxiosError(error)) {
          if (error.response?.status === 404) {
            console.log(`[API /github/copy-item-intra-branch] Source path '${sourcePath}' not found.`);
            return NextResponse.json({ error: `Source path '${sourcePath}' not found.` }, { status: 404 });
          }
          console.error(`[API /github/copy-item-intra-branch] Error fetching source item data:`, error.response?.data || error.message);
      } else if (error instanceof Error) {
           console.error(`[API /github/copy-item-intra-branch] Error fetching source item data:`, error.message);
      } else {
           console.error(`[API /github/copy-item-intra-branch] Error fetching source item data: Unknown error`, error);
      }
      throw new Error('Failed to fetch source item details.');
    }

    // Determine source type (GitHub returns array for dir, object for file)
    const sourceType = Array.isArray(sourceItemData) ? 'dir' : (sourceItemData?.type === 'file' ? 'file' : 'unknown');
     console.log(`[API /github/copy-item-intra-branch] Determined source type: ${sourceType}`);

    let newCommitSha: string | null = null;
    let finalCommitData: GitHubCommitResponseCommit | null = null;

    // --- Handle FILE Copy (Contents API PUT) ---
    if (sourceType === 'file') {
        console.log(`[API /github/copy-item-intra-branch] Source is FILE. Using Contents API.`);
        if (!sourceItemData.content) {
            console.error("[API /github/copy-item-intra-branch] File content missing from source data.");
            throw new Error('Source file content could not be retrieved.');
        }
        const fileContentBase64 = sourceItemData.content.replace(/\n/g, '');

        // Check if destination exists to get SHA for overwrite
        const destContentsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(fullNewPath)}`
        let currentDestSha: string | null = null;
        try {
            const destCheckResponse = await axios.get(`${destContentsUrl}?ref=${encodeURIComponent(branch)}`, { headers: githubAuthHeaders });
            currentDestSha = destCheckResponse.data.sha;
            console.log(`[API /github/copy-item-intra-branch] Destination file exists, SHA: ${currentDestSha}. Will overwrite.`);
        } catch (error: unknown) {
            // Use type guards
            if (axios.isAxiosError(error)) {
                if (error.response?.status !== 404) { // Ignore 404
                    console.error(`[API /github/copy-item-intra-branch] Error checking destination path ${fullNewPath}:`, error.response?.data || error.message);
                    throw new Error('Failed to check destination path.');
                }
            } else if (error instanceof Error) {
                console.error(`[API /github/copy-item-intra-branch] Error checking destination path ${fullNewPath}:`, error.message);
                throw new Error('Failed to check destination path.');
            } else {
                console.error(`[API /github/copy-item-intra-branch] Error checking destination path ${fullNewPath}: Unknown error`, error);
                throw new Error('Failed to check destination path.');
            }
            console.log(`[API /github/copy-item-intra-branch] Destination file does not exist. Will create.`);
        }

        // PUT the file content
        const putPayload = {
            message: commitMessage,
            content: fileContentBase64,
            branch: branch,
            ...(currentDestSha ? { sha: currentDestSha } : {}), // Include SHA only if updating
        };
        const putResponse = await axios.put(destContentsUrl, putPayload, { headers: githubAuthHeaders }); // Use headers, auth obj not needed for PUT w/ token header
        newCommitSha = putResponse.data?.commit?.sha;
        finalCommitData = putResponse.data?.commit;
        if (!newCommitSha || !finalCommitData) {
            throw new Error('Invalid commit response after file PUT.');
        }
        console.log(`[API /github/copy-item-intra-branch] File copied successfully via PUT. Commit SHA: ${newCommitSha}`);
    }
    // --- Handle FOLDER Copy (Git Data API) ---
    else if (sourceType === 'dir') {
        console.log(`[API /github/copy-item-intra-branch] Source is DIRECTORY. Using Git Data API.`);
        
        // Get latest commit and root tree SHA for the branch
        const latestCommitSha = await getBranchHeadSha(branch);
        const rootTreeSha = await getCommitTreeSha(latestCommitSha);

        // Get the full recursive tree for the branch
        const currentBranchTree = await getTree(rootTreeSha, true);

        // Filter items within the source path
        const sourcePathPrefix = sourcePath.endsWith('/') ? sourcePath : `${sourcePath}/`;
        const itemsToCopy = currentBranchTree.filter(item => item.path.startsWith(sourcePathPrefix));

        // Handle empty source folder: create destination with .gitkeep
        if (itemsToCopy.length === 0) {
            console.log("[API /github/copy-item-intra-branch] Source folder empty. Creating empty destination folder.");
            const gitkeepPath = `${fullNewPath}/.gitkeep`;
            const destContentsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(gitkeepPath)}`;
            const putPayload = {
                message: commitMessage + " (empty folder)",
                content: Buffer.from('# Empty directory placeholder').toString('base64'),
                branch: branch,
            };
            try {
                const putResponse = await axios.put(destContentsUrl, putPayload, { headers: githubAuthHeaders });
                newCommitSha = putResponse.data?.commit?.sha;
                finalCommitData = putResponse.data?.commit;
                 if (!newCommitSha || !finalCommitData) {
                    throw new Error('Invalid commit response after empty folder PUT.');
                }
                 console.log(`[API /github/copy-item-intra-branch] Empty folder created via PUT. Commit SHA: ${newCommitSha}`);
                } catch (putError: unknown) {
                    let errorMsg = 'Unknown error creating empty destination folder.';
                    let isConflict = false;
                  
                    if (axios.isAxiosError(putError)) {
                      const statusCode = putError.response?.status;
                      const respData = putError.response?.data as { message?: string };
                  
                      // detect “already exists” or sha-conflict
                      if (
                        statusCode === 409 ||
                        (statusCode === 422 && respData.message?.includes('sha'))
                      ) {
                        isConflict = true;
                      }
                  
                      errorMsg = respData.message ?? putError.message;
                      console.error(
                        `[API /github/copy-item-intra-branch] AxiosError creating empty folder:`,
                        errorMsg
                      );
                    } else if (putError instanceof Error) {
                      errorMsg = putError.message;
                      console.error(
                        `[API /github/copy-item-intra-branch] Error creating empty folder:`,
                        errorMsg
                      );
                    } else {
                      console.error(
                        `[API /github/copy-item-intra-branch] Unknown error creating empty folder:`,
                        putError
                      );
                    }
                  
                    if (isConflict) {
                      return NextResponse.json(
                        {
                          error: `Conflict creating placeholder in destination folder '${fullNewPath}'. It might already exist.`
                        },
                        { status: 409 }
                      );
                    }
                  
                    // re-throw so outer catch can handle it
                    throw new Error(
                      `Failed to create empty destination folder placeholder: ${errorMsg}`
                    );
                  }
                  
        } else {
            // Remap items to the new destination path
            const remappedItems = itemsToCopy.map(item => ({
                path: item.path.replace(sourcePath, fullNewPath), // Adjust path
                mode: item.mode,
                type: item.type,
                sha: item.sha, // Use original SHA for blobs/trees
            }));
            console.log(`[API /github/copy-item-intra-branch] Remapped ${remappedItems.length} items to destination ${fullNewPath}`);

            // Create the new tree definition: start with current tree, remove conflicts, add remapped
            const destPathPrefix = fullNewPath.endsWith('/') ? fullNewPath : `${fullNewPath}/`;
            const baseTreeDefinition = currentBranchTree
                .filter(item => !item.path.startsWith(destPathPrefix) && item.path !== fullNewPath) // Remove destination conflicts
                .map(item => ({ path: item.path, mode: item.mode, type: item.type, sha: item.sha })); 
            
            const finalTreeDefinition = [...baseTreeDefinition, ...remappedItems];

            // Create the new tree object
            console.log(`[API /github/copy-item-intra-branch] Creating new tree object for folder copy...`);
            const newTreeSha = await createTree(finalTreeDefinition);
            console.log(`[API /github/copy-item-intra-branch] New tree SHA: ${newTreeSha}`);

            // Create the commit
            console.log(`[API /github/copy-item-intra-branch] Creating commit...`);
            const createCommitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`;
            const createCommitPayload = {
                message: commitMessage,
                tree: newTreeSha,
                parents: [latestCommitSha],
            };
            const createCommitResponse = await axios.post(createCommitUrl, createCommitPayload, { headers: githubAuthHeaders });
            newCommitSha = createCommitResponse.data?.sha;
            finalCommitData = createCommitResponse.data;
             if (!newCommitSha || !finalCommitData) {
                throw new Error('Invalid commit response after folder copy.');
            }
            console.log(`[API /github/copy-item-intra-branch] New commit SHA for folder copy: ${newCommitSha}`);

            // Update branch reference
            console.log(`[API /github/copy-item-intra-branch] Updating branch reference '${branch}' to ${newCommitSha}`);
            const updateRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branch}`;
            await axios.patch(updateRefUrl, { sha: newCommitSha }, { headers: githubAuthHeaders });
            console.log(`[API /github/copy-item-intra-branch] Branch '${branch}' updated successfully.`);
        }
    } else {
         console.error(`[API /github/copy-item-intra-branch] Unsupported source item type: ${sourceType}`);
        return NextResponse.json({ error: `Unsupported source item type encountered.` }, { status: 400 });
    }

    // --- Auto Tagging (Common for both file/folder copy) ---
    let newTagName: string | null = null;
    let tagResult: { success: boolean; error?: string } = { success: false, error: 'Tagging skipped or failed.' };
    if (newCommitSha) { // Only tag if a new commit was successfully created
        try {
            const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
            const tagsResponse = await axios.get(tagsUrl, { headers: githubAuthHeaders });
            const latestTag = getLatestSemanticTag(tagsResponse.data);
            newTagName = incrementVersion(latestTag, 'patch');
            console.log(`[API /github/copy-item-intra-branch] Calculated next tag: ${newTagName}`);
            if (newTagName) {
                tagResult = await createTagReference(newTagName, newCommitSha);
            } else { tagResult.error = 'Could not calculate new tag name.'; }
        } catch (tagLookupError: unknown) { 
             let message = 'Error processing existing tags.';
             if (tagLookupError instanceof Error) {
                 message = tagLookupError.message;
             } else if (axios.isAxiosError(tagLookupError)) {
                 // Safely access response data if it's an AxiosError
                 message = tagLookupError.response?.data?.message || tagLookupError.message || message;
             }
             console.error('[API /github/copy-item-intra-branch] Error during tag lookup/calculation:', message);
             tagResult.error = message;
        }
    } else {
        console.log('[API /github/copy-item-intra-branch] Skipping tagging because no commit was generated.');
        tagResult.error = 'Skipped tagging: No commit generated.';
    }
    // --- End Auto Tagging ---

    // --- Construct Response ---
    let finalMessage = `${sourceType === 'file' ? 'File' : 'Folder'} copied to '${fullNewPath}' successfully.`;
    let finalStatus = 200;

    if (tagResult.success) {
        finalMessage += ` New state tagged as ${newTagName}.`;
    } else {
        finalMessage += ` Failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
        finalStatus = 207; // Partial success
    }

    console.log(`[API /github/copy-item-intra-branch] Responding with status: ${finalStatus}`);
    return NextResponse.json({ 
        success: true, // Copy operation succeeded before tagging attempt
        message: finalMessage, 
        commit: finalCommitData, 
        ...(tagResult.success && { tag: newTagName }),
        ...(tagResult.error && { tagError: tagResult.error })
    }, { status: finalStatus });

} catch (error: unknown) {
    let status = 500;
    let errorMessage = 'Failed to copy item.';
  
    if (axios.isAxiosError(error)) {
      status = error.response?.status ?? 500;
      const respData = error.response?.data as { message?: string };
      errorMessage = respData.message ?? error.message;
      console.error(
        `[API /github/copy-item-intra-branch] AxiosError copying item:`,
        errorMessage
      );
    } else if (error instanceof Error) {
      errorMessage = error.message;
      console.error(
        `[API /github/copy-item-intra-branch] Error copying item:`,
        errorMessage
      );
    } else {
      console.error(
        `[API /github/copy-item-intra-branch] Unknown error copying item:`,
        error
      );
    }
  
    return NextResponse.json({ error: errorMessage }, { status });
  }  
} 