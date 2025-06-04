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

    // 4. Perform the file copy loop, targeting the TEMP BRANCH
    const copyResults: { path: string; status: string; reason?: string; url?: string }[] = [];
    let lastSuccessfulCommitShaOnTempBranch: string | null = null;
    let prFlowCopySuccess = true; // Assume success until an error occurs
    let prFlowSomeFilesCopied = false;

    console.log(`[API /github/copy-files] Starting PR flow copy of ${paths.length} paths from ${source_branch} to ${tempBranchName}`);
    for (const filePath of paths) {
        const getUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(source_branch)}`;
        let sourceContent: string | null = null;

        // 4a. Get file content from source branch
        try {
            console.log(`[API /github/copy-files][PR Flow] Getting source file: ${filePath} from ${source_branch}`);
            const getResp = await axios.get(getUrl, { headers: githubAuthHeaders });
            if (getResp.data?.content && getResp.data?.encoding === 'base64') {
                sourceContent = getResp.data.content;
            } else {
                copyResults.push({ path: filePath, status: 'skipped', reason: `Unsupported encoding: ${getResp.data?.encoding || 'unknown'} or missing content` });
                console.warn(`[API /github/copy-files][PR Flow] Skipped ${filePath}: Unsupported encoding or missing content.`);
                continue;
            }
        } catch (err: unknown) {
            if (axios.isAxiosError(err)) {
                if (err.response?.status === 404) {
                    console.warn(`[API /github/copy-files][PR Flow] Skipped ${filePath}: File not found in source branch ${source_branch}.`);
                    copyResults.push({ path: filePath, status: 'skipped', reason: 'File not found in source branch' });
                } else {
                    console.error(`[API /github/copy-files][PR Flow] Error fetching source file ${filePath}:`, err.response?.data || err.message);
                    copyResults.push({ path: filePath, status: 'error', reason: `Error fetching source: ${err.response?.data?.message || err.message}` });
                    prFlowCopySuccess = false;
                }
            } else if (err instanceof Error) {
                console.error(`[API /github/copy-files][PR Flow] Error fetching source file ${filePath}:`, err.message);
                copyResults.push({ path: filePath, status: 'error', reason: `Error fetching source: ${err.message}` });
                prFlowCopySuccess = false;
            } else {
                console.error(`[API /github/copy-files][PR Flow] Unknown error fetching source file ${filePath}:`, err);
                copyResults.push({ path: filePath, status: 'error', reason: 'Unknown error fetching source file.' });
                prFlowCopySuccess = false;
            }
            continue; // Skip to next file on error
        }

        // 4b. Check if file exists in temp branch to get its SHA (for update)
        let tempBranchSha: string | null = null;
        try {
            console.log(`[API /github/copy-files][PR Flow] Checking target file: ${filePath} on ${tempBranchName}`);
            const checkUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(tempBranchName)}`;
            const checkResp = await axios.get(checkUrl, { headers: githubAuthHeaders });
            tempBranchSha = checkResp.data.sha;
            console.log(`[API /github/copy-files][PR Flow] Target file ${filePath} exists on temp branch. SHA: ${tempBranchSha}`);
        } catch (err: unknown) {
             // A 404 error here is EXPECTED if the file doesn't exist on the temp branch yet.
             // Only treat other errors as failures for this step.
             if (axios.isAxiosError(err) && err.response?.status === 404) {
                 console.log(`[API /github/copy-files][PR Flow] Target file ${filePath} does not exist on temp branch. Will create.`);
                 // Do nothing, tempBranchSha remains null - proceed to PUT
             } else { 
                 // Handle actual errors during the check
                 let checkErrorMsg = 'Unknown error checking target file on temp branch.';
                 if (axios.isAxiosError(err)) {
                     checkErrorMsg = `Error checking target on temp branch: ${err.response?.data?.message || err.message}`;
                     console.error(`[API /github/copy-files][PR Flow] Axios error checking target file ${filePath} on temp branch:`, err.response?.data || err.message);
                 } else if (err instanceof Error) {
                     checkErrorMsg = `Error checking target on temp branch: ${err.message}`;
                     console.error(`[API /github/copy-files][PR Flow] Error checking target file ${filePath} on temp branch:`, err.message);
                 } else {
                     console.error(`[API /github/copy-files][PR Flow] Unknown error checking target file ${filePath} on temp branch:`, err);
                 }
                 copyResults.push({ path: filePath, status: 'error', reason: checkErrorMsg });
                 prFlowCopySuccess = false;
                 continue; // Skip this file if the check fails for reasons other than 404
             }
        }

        // 4c. Prepare payload and PUT file to temp branch
        const putPayload = {
            message: `Copy ${filePath} from ${source_branch} [via PR flow by ${username}]`,
            content: sourceContent,
            branch: tempBranchName,
            ...(tempBranchSha ? { sha: tempBranchSha } : {}),
        };

        try {
            console.log(`[API /github/copy-files][PR Flow] Putting file: ${filePath} to ${tempBranchName}`);
            const putUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`;
            const putResp = await axios.put(putUrl, putPayload, { headers: githubAuthHeaders });

            lastSuccessfulCommitShaOnTempBranch = putResp.data?.commit?.sha;
            prFlowSomeFilesCopied = true;

            if (!lastSuccessfulCommitShaOnTempBranch) {
                console.error('[API /github/copy-files][PR Flow] Missing commit SHA in PUT response for path:', filePath);
                copyResults.push({ path: filePath, status: 'error', reason: 'Missing commit SHA in GitHub response after PUT to temp branch.' });
                prFlowCopySuccess = false; // Treat missing SHA as an error
            } else {
                copyResults.push({
                    path: filePath,
                    status: tempBranchSha ? 'updated' : 'created',
                    url: putResp.data?.content?.html_url,
                });
                console.log(`[API /github/copy-files][PR Flow] Successfully copied ${filePath} to ${tempBranchName}. Commit SHA: ${lastSuccessfulCommitShaOnTempBranch}`);
            }
        } catch (err: unknown) {
            let message = 'Unknown error during file copy to temp branch.';
             if (axios.isAxiosError(err)) {
                 console.error(`[API /github/copy-files][PR Flow] Axios error putting file ${filePath} to temp branch:`, err.response?.data || err.message);
                 message = `Failed PUT to temp branch: ${err.response?.data?.message || err.message}`;
             } else if (err instanceof Error) {
                 console.error(`[API /github/copy-files][PR Flow] Error putting file ${filePath} to temp branch:`, err.message);
                 message = `Failed PUT to temp branch: ${err.message}`;
             } else {
                 console.error(`[API /github/copy-files][PR Flow] Unknown error putting file ${filePath} to temp branch:`, err);
             }
            copyResults.push({ path: filePath, status: 'error', reason: message });
            prFlowCopySuccess = false; // Mark as failure
        }
    } // End loop over paths for PR flow
    console.log('[API /github/copy-files][PR Flow] Finished processing paths.');

    // 5. Create a Pull Request if files were copied successfully
    if (prFlowSomeFilesCopied && prFlowCopySuccess) { // Only proceed if copy had no errors and at least one file was processed
        try {
            const prUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls`;
            const prPayload = {
                title: `Copy files from ${source_branch} to main by ${username}`,
                body: `Automated PR to copy ${copyResults.filter(r => r.status === 'created' || r.status === 'updated').length} file(s) from branch '${source_branch}' to 'main'. Initiated by ${username}.\n\nCopied files:\n${copyResults.filter(r => r.status === 'created' || r.status === 'updated').map(r => `- ${r.path}`).join('\n')}\n\nSkipped files:\n${copyResults.filter(r => r.status === 'skipped').map(r => `- ${r.path} (${r.reason || 'unknown'})`).join('\n')}`,
                head: tempBranchName,
                base: 'main'
            };
            console.log(`[API /github/copy-files][PR Flow] Creating PR from ${tempBranchName} to main.`);
            const prResp = await axios.post(prUrl, prPayload, { headers: githubAuthHeaders });
            console.log(`[API /github/copy-files][PR Flow] Successfully created PR: ${prResp.data.html_url}`);

            return NextResponse.json({
                success: true, // Overall PR flow succeeded
                message: `User lacks permission for direct push to main. Files copied to temporary branch '${tempBranchName}' and Pull Request created.`,
                pullRequestUrl: prResp.data.html_url,
                results: copyResults,
            }, { status: 201 }); // 201 Created (for the PR)

        } catch (err: any) {
            console.error(`[API /github/copy-files][PR Flow] Error creating Pull Request from ${tempBranchName} to main:`, err.response?.data || err.message);
            return NextResponse.json({
                success: false,
                message: `Files copied to temporary branch '${tempBranchName}', but failed to create Pull Request. Please create it manually or retry. Reason: ${err.response?.data?.message || err.message}`,
                results: copyResults,
                tempBranch: tempBranchName
            }, { status: 500 });
        }
    } else {
         // Copy process failed or skipped all files
         const failureReason = prFlowCopySuccess ? 'No files were eligible for copying (all skipped or source files missing).' : 'Errors occurred during file copy process to temporary branch.';
         console.log(`[API /github/copy-files][PR Flow] Skipping PR creation. Reason: ${failureReason}`);
         // Consider cleaning up temp branch here if desired
         return NextResponse.json({
             success: false,
             message: `Copy operation failed. ${failureReason}`,
             results: copyResults,
             tempBranch: tempBranchName
         }, { status: prFlowCopySuccess ? 400 : 500 }); // 400 if only skips, 500 if errors
    }
    // End of PR flow logic
  } else if (!validationResult.valid) {
    // Original permission failure for a branch OTHER than main
    console.log(`[API /github/copy-files] User validation failed for non-main target branch ${target_branch}: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }

  // --- Direct Copy Logic (if target != main OR user has permission for main) ---
  console.log(`[API /github/copy-files] Proceeding with direct copy to ${target_branch}.`);

  const copyResults: { path: string; status: string; reason?: string; url?: string }[] = [];
  let lastSuccessfulCommitSha: string | null = null; 
  let overallSuccess = true; // Track if all copies succeeded without error status
  let someFilesCopied = false; // Track if at least one file was actually copied/updated

  console.log(`[API /github/copy-files][Direct] Starting copy of ${paths.length} paths from ${source_branch} to ${target_branch}`);

  try {
    for (const filePath of paths) {
      const getUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(source_branch)}`;
      let sourceContent: string | null = null;

      // 1. Get file content from source branch
      try {
        console.log(`[API /github/copy-files][Direct] Getting source file: ${filePath} from ${source_branch}`);
        const getResp = await axios.get(getUrl, { headers: githubAuthHeaders });
        if (getResp.data?.content && getResp.data?.encoding === 'base64') {
            sourceContent = getResp.data.content;
        } else {
            copyResults.push({ path: filePath, status: 'skipped', reason: `Unsupported encoding: ${getResp.data?.encoding || 'unknown'} or missing content` });
            console.warn(`[API /github/copy-files][Direct] Skipped ${filePath}: Unsupported encoding or missing content.`);
            continue;
        }
      } catch (err: unknown) {
          if (axios.isAxiosError(err)) {
              if (err.response?.status === 404) {
                console.warn(`[API /github/copy-files][Direct] Skipped ${filePath}: File not found in source branch ${source_branch}.`);
                copyResults.push({ path: filePath, status: 'skipped', reason: 'File not found in source branch' });
              } else {
                 console.error(`[API /github/copy-files][Direct] Error fetching source file ${filePath}:`, err.response?.data || err.message);
                 copyResults.push({ path: filePath, status: 'error', reason: `Error fetching source: ${err.response?.data?.message || err.message}` });
                 overallSuccess = false;
              }
          } else if (err instanceof Error) {
             console.error(`[API /github/copy-files][Direct] Error fetching source file ${filePath}:`, err.message);
             copyResults.push({ path: filePath, status: 'error', reason: `Error fetching source: ${err.message}` });
             overallSuccess = false;
          } else {
             console.error(`[API /github/copy-files][Direct] Unknown error fetching source file ${filePath}:`, err);
             copyResults.push({ path: filePath, status: 'error', reason: 'Unknown error fetching source file.' });
             overallSuccess = false;
          }
          continue; // Skip to next file on error
      }

      // 2. Check if file exists in target branch to get its SHA (for update)
      let targetSha: string | null = null;
      try {
         console.log(`[API /github/copy-files][Direct] Checking target file: ${filePath} on ${target_branch}`);
         const checkUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(target_branch)}`;
        const checkResp = await axios.get(checkUrl, { headers: githubAuthHeaders });
        targetSha = checkResp.data.sha;
         console.log(`[API /github/copy-files][Direct] Target file ${filePath} exists. SHA: ${targetSha}`);
      } catch (err: unknown) {
          if (axios.isAxiosError(err) && err.response?.status === 404) {
              // This is the expected case: file does not exist on target branch.
              console.log(`[API /github/copy-files][Direct] Target file ${filePath} does not exist on ${target_branch}. Will create.`);
              // targetSha remains null, proceed to PUT for creation.
          } else {
              // Any other error during the target check is a problem.
              let checkErrorMsg = 'Unknown error checking target file.';
              if (axios.isAxiosError(err)) {
                  checkErrorMsg = `Error checking target file ${filePath} on ${target_branch}: ${err.response?.data?.message || err.message}`;
                  console.error(`[API /github/copy-files][Direct] Axios error checking target file:`, err.response?.data || err.message);
              } else if (err instanceof Error) {
                  checkErrorMsg = `Error checking target file ${filePath} on ${target_branch}: ${err.message}`;
                  console.error(`[API /github/copy-files][Direct] Error checking target file:`, err.message);
              } else {
                  console.error(`[API /github/copy-files][Direct] Unknown error checking target file:`, err);
              }
              copyResults.push({ path: filePath, status: 'error', reason: checkErrorMsg });
              overallSuccess = false;
              continue; // Skip this file if the check fails for reasons other than 404
          }
      }

      // 3. Prepare payload and PUT file to target branch
      const putPayload = {
        message: `Copy ${filePath} from ${source_branch} [author: ${username}]`, // Add author
        content: sourceContent, // Already base64
        branch: target_branch,
        ...(targetSha ? { sha: targetSha } : {}), // Include SHA only if updating
      };

      try {
        console.log(`[API /github/copy-files][Direct] Putting file: ${filePath} to ${target_branch}`);
        const putUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`;
        const putResp = await axios.put(putUrl, putPayload, { headers: githubAuthHeaders });
        
        lastSuccessfulCommitSha = putResp.data?.commit?.sha; // Capture SHA of this commit
        someFilesCopied = true; // Mark that at least one file operation succeeded

        if (!lastSuccessfulCommitSha) {
             console.error('[API /github/copy-files][Direct] Missing commit SHA in PUT response for path:', filePath);
             copyResults.push({ path: filePath, status: 'error', reason: 'Missing commit SHA in GitHub response after PUT.' });
             overallSuccess = false; // Treat missing SHA as an error
        } else {
            copyResults.push({
                path: filePath,
                status: targetSha ? 'updated' : 'created',
                url: putResp.data?.content?.html_url,
            });
             console.log(`[API /github/copy-files][Direct] Successfully copied ${filePath}. Commit SHA: ${lastSuccessfulCommitSha}`);
        }
      } catch (err: unknown) {
          let message = 'Unknown error during file copy.';
          if (axios.isAxiosError(err)) {
             console.error(`[API /github/copy-files][Direct] Axios error putting file ${filePath} to target branch:`, err.response?.data || err.message);
             message = `Failed to update target: ${err.response?.data?.message || err.message}`;
          } else if (err instanceof Error) {
             console.error(`[API /github/copy-files][Direct] Error putting file ${filePath} to target branch:`, err.message);
             message = `Failed to update target: ${err.message}`;
          } else {
             console.error(`[API /github/copy-files][Direct] Unknown error putting file ${filePath} to target branch:`, err);
          }
          copyResults.push({ path: filePath, status: 'error', reason: message });
          overallSuccess = false; // Mark overall success as false if any error occurs
      }
    } // End loop over paths for direct copy

    console.log('[API /github/copy-files][Direct] Finished processing paths.');

    // --- Auto Tagging Logic (Only for Direct Copy) ---
    let tagResult: { success: boolean; error?: string } = { success: false, error: 'Tagging skipped: No successful file copies resulted in a commit.' };
    let finalMessage = 'File copy process completed.';
    let finalStatus = 200;
    let newTagName: string | null = null;

    if (lastSuccessfulCommitSha && someFilesCopied) { // Only tag if something was actually copied/updated directly
        console.log(`[API /github/copy-files][Direct] Attempting to tag last successful commit: ${lastSuccessfulCommitSha}`);
        try {
            const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
            const tagsResponse = await axios.get(tagsUrl, { headers: githubAuthHeaders }); 
            const latestTag = getLatestSemanticTag(tagsResponse.data);
            newTagName = incrementVersion(latestTag, 'patch'); // Force patch bump for copies
            console.log(`[API /github/copy-files][Direct] Calculated next tag: ${newTagName}`);
            if (newTagName) {
                tagResult = await createTagReference(newTagName, lastSuccessfulCommitSha);
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
             finalStatus = overallSuccess ? 200 : 207; // Use 207 if there were non-blocking errors earlier
        } else {
             finalMessage = `Files copied to ${target_branch} (with potential errors/skips), but failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
             finalStatus = 207; // Partial success
        }
    } else if (someFilesCopied) {
        finalMessage = `File copy process to ${target_branch} completed, but automatic tagging was skipped.`;
        finalStatus = overallSuccess ? 200 : 207;
    } else {
        finalMessage = `File copy process to ${target_branch} completed, but no files were successfully copied/updated.`;
        finalStatus = overallSuccess ? 200 : (copyResults.some(r => r.status === 'error') ? 500 : 400); // 500 if errors, 400 if only skips
    }
    // --- End Auto Tagging Logic ---

    console.log(`[API /github/copy-files][Direct] Responding with status: ${finalStatus}, Message: ${finalMessage}`);
    return NextResponse.json({ 
        success: overallSuccess && (someFilesCopied ? tagResult.success : true), // Success if copy+tag ok, or if no copy needed + overall ok
        message: finalMessage,
        results: copyResults,
        ...(tagResult.error && { tagError: tagResult.error }),
        ...(tagResult.success && { tag: newTagName })
    }, { status: finalStatus });

  } catch (error: unknown) {
    // Catch unexpected errors during the direct copy loop setup or final response generation
    let message = 'Unexpected server error during direct copy process.';
    if (error instanceof Error) {
       message = error.message;
    }
    console.error('[API /github/copy-files][Direct] Unexpected error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}