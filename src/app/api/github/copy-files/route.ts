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
 * POST /api/github/copy-files
 * Copies files from one branch to another.
 * If the target is 'main' and the user lacks direct push permission,
 * it creates a temporary branch, copies files there, and creates a Pull Request.
 * Otherwise, it copies directly to the target branch and applies a patch tag.
 */
export async function POST(request: Request) {
  console.log('[API /github/copy-files] Received request');
  let body;
  try {
    body = await request.json();
     console.log('[API /github/copy-files] Request body parsed:', { 
         user: body?.username, 
         source: body?.source_branch, 
         target: body?.target_branch, 
         // paths: body?.paths // Log paths later if needed, can be large
     });
     if (!Array.isArray(body?.paths)) {
         throw new Error("paths field is missing or not an array");
     }
     console.log(`[API /github/copy-files] Paths count: ${body.paths.length}`);
  } catch (e: any) {
    console.error('[API /github/copy-files] Error parsing request body:', e.message);
    return NextResponse.json({ error: `Invalid request body: ${e.message}` }, { status: 400 });
  }

  const { username, password, source_branch, target_branch, paths } = body;

  // Validate required fields
  if (!username || !password || !source_branch || !target_branch || paths.length === 0) {
     console.log('[API /github/copy-files] Validation failed: Missing or invalid fields.');
    return NextResponse.json({
      error: 'Missing or invalid fields: username, password, source_branch, target_branch, paths (must be non-empty array)',
    }, { status: 400 });
  }

   // Validate user credentials against the TARGET branch
   console.log(`[API /github/copy-files] Validating user ${username} for target branch ${target_branch}...`);
  const validationResult = await validateUser(username, password, target_branch);
  console.log(`[API /github/copy-files] User validation result for ${target_branch}:`, validationResult);

  // --- Reusable Git Tree Copy Function ---
  const performGitTreeCopy = async (
    sourceBranch: string, 
    targetBranch: string, 
    filePaths: string[], 
    commitUsername: string
  ) => {
    try {
        // Helper to get branch commit info
        const getBranchCommit = async (branchName: string) => {
            const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches/${encodeURIComponent(branchName)}`;
            const response = await axios.get(url, { headers: githubAuthHeaders });
            return response.data.commit; // { sha, url }
        };

        // Helper to get commit tree sha
        const getCommitTreeSha = async (commitSha: string) => {
            const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${commitSha}`;
            const response = await axios.get(url, { headers: githubAuthHeaders });
            return response.data.tree.sha;
        };

        // Helper to get a full recursive tree from the source branch
        const getRecursiveSourceTree = async (commitSha: string) => {
            const treeSha = await getCommitTreeSha(commitSha);
            const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${treeSha}?recursive=1`;
            const response = await axios.get(url, { headers: githubAuthHeaders });
            if (response.data.truncated) {
                console.warn(`[API /github/copy-files] Warning: Source tree data for ${treeSha} was truncated. Some files may not be copied if the repository is very large.`);
            }
            return response.data.tree as { path: string, mode: string, type: 'blob' | 'tree', sha: string }[];
        };

        // 1. Get branch info
        console.log(`[API /github/copy-files][TreeCopy] Fetching branch info for ${sourceBranch} and ${targetBranch}...`);
        const sourceCommit = await getBranchCommit(sourceBranch);
        const targetCommit = await getBranchCommit(targetBranch);
        const parentCommitSha = targetCommit.sha;

        // 2. Get the SHA of the target branch's tree to use as the base.
        console.log(`[API /github/copy-files][TreeCopy] Getting base tree SHA from target branch ${targetBranch}...`);
        const baseTreeSha = await getCommitTreeSha(parentCommitSha);
        
        // 3. Get the source tree to find the blobs we want to copy.
        console.log(`[API /github/copy-files][TreeCopy] Getting source tree...`);
        const sourceTree = await getRecursiveSourceTree(sourceCommit.sha);

        // 4. Construct the `tree` parameter for the API call.
        // This will only contain the files we want to add or update.
        console.log(`[API /github/copy-files][TreeCopy] Constructing new tree definition...`);
        const treeChanges: { path: string, mode: string, type: 'blob', sha: string }[] = [];
        const sourceFileMap = new Map(sourceTree.map(item => [item.path, item]));

        for (const filePath of filePaths) {
            const sourceFile = sourceFileMap.get(filePath);
            if (sourceFile && sourceFile.type === 'blob') {
                treeChanges.push({
                    path: sourceFile.path,
                    mode: sourceFile.mode,
                    type: 'blob',
                    sha: sourceFile.sha,
                });
            }
        }
        
        // Build a report of what was done
        const copyResults: { path: string; status: string; reason?: string }[] = [];
        // Note: We can't easily know if a file was 'created' or 'updated' without fetching the target tree,
        // which we are avoiding. We'll simply report 'copied'. A more advanced check could be added if needed.
        filePaths.forEach((p: string) => {
            if (sourceFileMap.has(p) && sourceFileMap.get(p)?.type === 'blob') {
                copyResults.push({ path: p, status: 'copied' });
            } else {
                copyResults.push({ path: p, status: 'skipped', reason: 'File not found or is not a blob in source branch' });
            }
        });

        const someFilesCopied = treeChanges.length > 0;
        if (!someFilesCopied) {
            return { success: true, someFilesCopied: false, results: copyResults, newCommitSha: null, message: "No eligible files found to copy." };
        }
        
        // 5. Create the new tree object using the base_tree parameter.
        const createTreeUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees`;
        const createTreePayload = {
            base_tree: baseTreeSha,
            tree: treeChanges,
        };
        const createTreeResp = await axios.post(createTreeUrl, createTreePayload, { headers: githubAuthHeaders });
        const newTreeSha = createTreeResp.data.sha;
        console.log(`[API /github/copy-files][TreeCopy] New tree created. SHA: ${newTreeSha}`);

        // 6. Create a new commit
        const createCommitUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`;
        const commitMessage = `Copy ${treeChanges.length} file(s) from ${sourceBranch} [author: ${commitUsername}]`;
        const createCommitPayload = { message: commitMessage, tree: newTreeSha, parents: [parentCommitSha] };
        const createCommitResp = await axios.post(createCommitUrl, createCommitPayload, { headers: githubAuthHeaders });
        const newCommitSha = createCommitResp.data.sha;
        console.log(`[API /github/copy-files][TreeCopy] New commit created. SHA: ${newCommitSha}`);

        // 7. Update the target branch reference
        const updateRefUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${encodeURIComponent(targetBranch)}`;
        await axios.patch(updateRefUrl, { sha: newCommitSha }, { headers: githubAuthHeaders });
        console.log(`[API /github/copy-files][TreeCopy] Branch ref for ${targetBranch} updated successfully.`);

        // --- Debug: Fetch and log blob SHA and mode for each copied file on both branches ---
        for (const file of treeChanges) {
            try {
                // Source branch
                const srcResp = await axios.get(`${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(file.path)}?ref=${encodeURIComponent(sourceBranch)}`, { headers: githubAuthHeaders });
                // Target branch
                const tgtResp = await axios.get(`${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(file.path)}?ref=${encodeURIComponent(targetBranch)}`, { headers: githubAuthHeaders });
                console.log(`[API /github/copy-files][DEBUG] File: ${file.path}`);
                console.log(`  Source branch (${sourceBranch}): sha=${srcResp.data.sha}, mode=${srcResp.data.mode}`);
                console.log(`  Target branch (${targetBranch}): sha=${tgtResp.data.sha}, mode=${tgtResp.data.mode}`);
            } catch (e) {
                let msg = '';
                if (e && typeof e === 'object') {
                  if ('message' in e && typeof (e as any).message === 'string') {
                    msg = (e as any).message;
                  } else if ('toString' in e) {
                    msg = (e as any).toString();
                  } else {
                    msg = JSON.stringify(e);
                  }
                } else {
                  msg = String(e);
                }
                console.warn(`[API /github/copy-files][DEBUG] Could not fetch blob info for ${file.path}:`, msg);
            }
        }

        return { success: true, someFilesCopied: true, results: copyResults, newCommitSha, message: "Copy successful." };

    } catch (error: unknown) {
        let message = 'Unexpected server error during Git tree copy process.';
        if (axios.isAxiosError(error)) {
            message = error.response?.data?.message || error.message;
            if (error.response?.status === 404) {
                message = `One of the branches (${sourceBranch} or ${targetBranch}) could not be found. ${message}`;
            }
            console.error(`[API /github/copy-files][TreeCopy] Axios error:`, error.response?.data || error.message);
        } else if (error instanceof Error) {
           message = error.message;
           console.error('[API /github/copy-files][TreeCopy] Unexpected error:', error.message);
        }
        return { success: false, someFilesCopied: false, results: [], newCommitSha: null, message };
    }
  };

  // --- Main Branch PR Flow Logic ---
  if (target_branch === 'main' && !validationResult.valid) {
    console.log(`[API /github/copy-files] User lacks direct push permission to main. Attempting PR flow.`);
    // Permission to create branches is implicitly assumed if they got this far,
    // but a more robust check could be added here if needed.

    // 1. Generate a unique temporary branch name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tempBranchName = `copy-to-main-${username}-${timestamp}`;
    console.log(`[API /github/copy-files] Generated temporary branch name: ${tempBranchName}`);

    // 2. Get the SHA of the **main** branch's HEAD
    let mainBranchSha: string;
    try {
        console.log(`[API /github/copy-files] Getting main branch SHA to create temporary branch from.`);
        const branchInfoUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches/main`; // Fetch main branch info
        const branchInfoResp = await axios.get(branchInfoUrl, { headers: githubAuthHeaders });
        mainBranchSha = branchInfoResp.data.commit.sha;
        console.log(`[API /github/copy-files] Main branch SHA: ${mainBranchSha}`);
    } catch (err: any) {
        console.error(`[API /github/copy-files] Error getting main branch SHA:`, err.response?.data || err.message);
        return NextResponse.json({ error: `Failed to get main branch details: ${err.response?.data?.message || err.message}` }, { status: 500 });
    }

    // 3. Create the temporary branch from the **main** branch SHA
    try {
        const createBranchUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`;
        await axios.post(createBranchUrl, {
            ref: `refs/heads/${tempBranchName}`,
            sha: mainBranchSha // Use the main branch SHA
        }, { headers: githubAuthHeaders });
        console.log(`[API /github/copy-files] Successfully created temporary branch '${tempBranchName}' from main branch SHA.`);
    } catch (err: any) {
        console.error(`[API /github/copy-files] Error creating temporary branch '${tempBranchName}':`, err.response?.data || err.message);
         if (axios.isAxiosError(err) && err.response?.status === 422) {
            return NextResponse.json({ error: `Temporary branch '${tempBranchName}' potentially already exists. Please try again or clean up manually. ${err.response?.data?.message || ''}` }, { status: 409 }); // Conflict
         }
        return NextResponse.json({ error: `Failed to create temporary branch: ${err.response?.data?.message || err.message}` }, { status: 500 });
    }

    // 4. Perform the file copy to the TEMP BRANCH using Git Tree Manipulation
    const copyOperationResult = await performGitTreeCopy(source_branch, tempBranchName, paths, username);

    // 5. Create a Pull Request if files were copied successfully
    if (copyOperationResult.someFilesCopied && copyOperationResult.success) {
        try {
            const prUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls`;
            const prPayload = {
                title: `Copy files from ${source_branch} to main by ${username}`,
                body: `Automated PR to copy ${copyOperationResult.results.filter(r => r.status === 'copied').length} file(s) from branch '${source_branch}' to 'main'. Initiated by ${username}.\n\nCopied files:\n${copyOperationResult.results.filter(r => r.status === 'copied').map(r => `- ${r.path}`).join('\n')}\n\nSkipped files:\n${copyOperationResult.results.filter(r => r.status === 'skipped').map(r => `- ${r.path} (${r.reason || 'unknown'})`).join('\n')}`,
                head: tempBranchName,
                base: 'main'
            };
            console.log(`[API /github/copy-files][PR Flow] Creating PR from ${tempBranchName} to main.`);
            const prResp = await axios.post(prUrl, prPayload, { headers: githubAuthHeaders });
            console.log(`[API /github/copy-files][PR Flow] Successfully created PR: ${prResp.data.html_url}`);

            return NextResponse.json({
                success: true,
                message: `User lacks permission for direct push to main. Files copied to temporary branch '${tempBranchName}' and Pull Request created.`,
                pullRequestUrl: prResp.data.html_url,
                results: copyOperationResult.results,
            }, { status: 201 }); // 201 Created (for the PR)

        } catch (err: any) {
            console.error(`[API /github/copy-files][PR Flow] Error creating Pull Request from ${tempBranchName} to main:`, err.response?.data || err.message);
            return NextResponse.json({
                success: false,
                message: `Files copied to temporary branch '${tempBranchName}', but failed to create Pull Request. Please create it manually or retry. Reason: ${err.response?.data?.message || err.message}`,
                results: copyOperationResult.results,
                tempBranch: tempBranchName
            }, { status: 500 });
        }
    } else {
         // Copy process failed or skipped all files
         const failureReason = copyOperationResult.success 
            ? 'No files were eligible for copying (all skipped or source files missing).' 
            : `Errors occurred during file copy process to temporary branch: ${copyOperationResult.message}`;

         console.log(`[API /github/copy-files][PR Flow] Skipping PR creation. Reason: ${failureReason}`);
         // Consider cleaning up temp branch here if desired
         return NextResponse.json({
             success: false,
             message: `Copy operation failed. ${failureReason}`,
             results: copyOperationResult.results,
             tempBranch: tempBranchName
         }, { status: copyOperationResult.success ? 400 : 500 }); // 400 if only skips, 500 if errors
    }
    // End of PR flow logic
  } else if (!validationResult.valid) {
    // Original permission failure for a branch OTHER than main
    console.log(`[API /github/copy-files] User validation failed for non-main target branch ${target_branch}: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }

  // --- Direct Copy Logic (if target != main OR user has permission for main) ---
  console.log(`[API /github/copy-files] Proceeding with direct copy to ${target_branch} using Git tree manipulation.`);

  const copyOperationResult = await performGitTreeCopy(source_branch, target_branch, paths, username);
  
  if (!copyOperationResult.success) {
      return NextResponse.json({ success: false, error: copyOperationResult.message, results: copyOperationResult.results }, { status: 500 });
  }

  // --- Auto Tagging Logic ---
  let tagResult: { success: boolean; error?: string } = { success: false, error: 'Tagging skipped: No commit was created.' };
  let finalMessage = copyOperationResult.message;
  let finalStatus = 200;
  let newTagName: string | null = null;
  
  if (copyOperationResult.newCommitSha && copyOperationResult.someFilesCopied) { 
      console.log(`[API /github/copy-files][Direct] Attempting to tag new commit: ${copyOperationResult.newCommitSha}`);
      try {
          const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
          const tagsResponse = await axios.get(tagsUrl, { headers: githubAuthHeaders }); 
          const latestTag = getLatestSemanticTag(tagsResponse.data);
          newTagName = incrementVersion(latestTag, 'patch');
          console.log(`[API /github/copy-files][Direct] Calculated next tag: ${newTagName}`);
          if (newTagName) {
              tagResult = await createTagReference(newTagName, copyOperationResult.newCommitSha);
          } else {
              tagResult.error = 'Could not calculate new tag name.';
          }
      } catch (tagLookupError: unknown) {
          let message = 'Error processing existing tags or creating new tag.';
          if (tagLookupError instanceof Error) {
             message = tagLookupError.message;
          } else if (axios.isAxiosError(tagLookupError)) {
             message = tagLookupError.response?.data?.message || tagLookupError.message || message;
          }
          console.error('[API /github/copy-files][Direct] Error during tag lookup/creation:', message);
          tagResult.error = message;
      }

      if (tagResult.success) {
           finalMessage = `Files copied successfully to ${target_branch}. New state tagged as ${newTagName}.`;
           finalStatus = 200;
      } else {
           finalMessage = `Files copied to ${target_branch}, but failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
           finalStatus = 207; // Partial success
      }
  } else if (!copyOperationResult.someFilesCopied) {
      finalMessage = `File copy process to ${target_branch} completed, but no files were eligible for copying.`;
      finalStatus = 200;
      tagResult.success = true; // Mark as success because no action was needed.
  }
  
  console.log(`[API /github/copy-files][Direct] Responding with status: ${finalStatus}, Message: ${finalMessage}`);
  return NextResponse.json({ 
      success: tagResult.success,
      message: finalMessage,
      results: copyOperationResult.results,
      ...(tagResult.error && { tagError: tagResult.error }),
      ...(tagResult.success && newTagName && { tag: newTagName })
  }, { status: finalStatus });
}
