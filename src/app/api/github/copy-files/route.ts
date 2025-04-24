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
 * Copies files from one branch to another and applies a patch tag.
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
         paths: body?.paths 
     });
  } catch (e) {
    console.error('[API /github/copy-files] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password, source_branch, target_branch, paths } = body;

  // Validate required fields
  if (!username || !password || !source_branch || !target_branch || !Array.isArray(paths) || paths.length === 0) {
     console.log('[API /github/copy-files] Validation failed: Missing or invalid fields.');
    return NextResponse.json({
      error: 'Missing or invalid fields: username, password, source_branch, target_branch, paths (must be non-empty array)',
    }, { status: 400 });
  }

   // Validate user credentials against the TARGET branch
   console.log(`[API /github/copy-files] Validating user ${username} for target branch ${target_branch}...`);
  const validationResult = await validateUser(username, password, target_branch);
  if (!validationResult.valid) {
     console.log(`[API /github/copy-files] User validation failed: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }
   console.log(`[API /github/copy-files] User ${username} validated for target branch.`);

  const copyResults: { path: string; status: string; reason?: string; url?: string }[] = [];
  let lastSuccessfulCommitSha: string | null = null; 
  let overallSuccess = true; // Track if all copies succeeded without error status
  let someFilesCopied = false; // Track if at least one file was actually copied/updated

  console.log(`[API /github/copy-files] Starting copy of ${paths.length} paths from ${source_branch} to ${target_branch}`);

  try {
    for (const filePath of paths) {
      const getUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(source_branch)}`;
      let sourceContent: string | null = null;

      // 1. Get file content from source branch
      try {
        console.log(`[API /github/copy-files] Getting source file: ${filePath} from ${source_branch}`);
        const getResp = await axios.get(getUrl, { headers: githubAuthHeaders });
        // Ensure content exists and encoding is base64
        if (getResp.data?.content && getResp.data?.encoding === 'base64') {
            sourceContent = getResp.data.content;
        } else {
            copyResults.push({ path: filePath, status: 'skipped', reason: `Unsupported encoding: ${getResp.data?.encoding || 'unknown'} or missing content` });
            console.warn(`[API /github/copy-files] Skipped ${filePath}: Unsupported encoding or missing content.`);
            continue; // Skip to next file
        }
      } catch (err: unknown) {
          // If file not found in source, skip it
          if (axios.isAxiosError(err)) {
              if (err.response?.status === 404) {
                console.warn(`[API /github/copy-files] Skipped ${filePath}: File not found in source branch ${source_branch}.`);
                copyResults.push({ path: filePath, status: 'skipped', reason: 'File not found in source branch' });
                continue; // Skip to next file
              } else {
                 // Log other errors but continue to try other files
                 console.error(`[API /github/copy-files] Error fetching source file ${filePath}:`, err.response?.data || err.message);
                 copyResults.push({ path: filePath, status: 'error', reason: `Error fetching source: ${err.response?.data?.message || err.message}` });
                 overallSuccess = false; // Mark overall as failed
                 continue; // Skip to next file
              }
          } else if (err instanceof Error) {
             console.error(`[API /github/copy-files] Error fetching source file ${filePath}:`, err.message);
             copyResults.push({ path: filePath, status: 'error', reason: `Error fetching source: ${err.message}` });
             overallSuccess = false;
             continue;
          } else {
             console.error(`[API /github/copy-files] Unknown error fetching source file ${filePath}:`, err);
             copyResults.push({ path: filePath, status: 'error', reason: 'Unknown error fetching source file.' });
             overallSuccess = false;
             continue;
          }
      }

      // 2. Check if file exists in target branch to get its SHA (for update)
      let targetSha: string | null = null;
      try {
         console.log(`[API /github/copy-files] Checking target file: ${filePath} on ${target_branch}`);
        const checkResp = await axios.get(`${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(target_branch)}`, { headers: githubAuthHeaders });
        targetSha = checkResp.data.sha;
         console.log(`[API /github/copy-files] Target file ${filePath} exists. SHA: ${targetSha}`);
      } catch (err: unknown) {
          if (axios.isAxiosError(err)) {
             if (err.response?.status !== 404) { // Ignore 404
                console.error(`[API /github/copy-files] Error checking target file ${filePath}:`, err.response?.data || err.message);
                 copyResults.push({ path: filePath, status: 'error', reason: `Error checking target: ${err.response?.data?.message || err.message}` });
                 overallSuccess = false;
                 continue;
             }
             console.log(`[API /github/copy-files] Target file ${filePath} does not exist. Will create.`);
          } else if (err instanceof Error) {
             console.error(`[API /github/copy-files] Error checking target file ${filePath}:`, err.message);
             copyResults.push({ path: filePath, status: 'error', reason: `Error checking target: ${err.message}` });
             overallSuccess = false;
             continue;
          } else {
             console.error(`[API /github/copy-files] Unknown error checking target file ${filePath}:`, err);
             copyResults.push({ path: filePath, status: 'error', reason: 'Unknown error checking target file.' });
             overallSuccess = false;
             continue;
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
        console.log(`[API /github/copy-files] Putting file: ${filePath} to ${target_branch}`);
        const putUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`;
        const putResp = await axios.put(putUrl, putPayload, { headers: githubAuthHeaders });
        
        lastSuccessfulCommitSha = putResp.data?.commit?.sha; // Capture SHA of this commit
        someFilesCopied = true; // Mark that at least one file operation succeeded

        if (!lastSuccessfulCommitSha) {
             console.error('[API /github/copy-files] Missing commit SHA in PUT response for path:', filePath);
             // Treat as error even if PUT didn't throw?
             copyResults.push({ path: filePath, status: 'error', reason: 'Missing commit SHA in GitHub response after PUT.' });
             overallSuccess = false;
        } else {
            copyResults.push({
                path: filePath,
                status: targetSha ? 'updated' : 'created',
                url: putResp.data?.content?.html_url,
            });
             console.log(`[API /github/copy-files] Successfully copied ${filePath}. Commit SHA: ${lastSuccessfulCommitSha}`);
        }
      } catch (err: unknown) {
          let message = 'Unknown error during file copy.';
          let status = 500;
          if (axios.isAxiosError(err)) {
             console.error(`[API /github/copy-files] Axios error putting file ${filePath} to target branch:`, err.response?.data || err.message);
             message = `Failed to update target: ${err.response?.data?.message || err.message}`;
             status = err.response?.status || 500;
          } else if (err instanceof Error) {
             console.error(`[API /github/copy-files] Error putting file ${filePath} to target branch:`, err.message);
             message = `Failed to update target: ${err.message}`;
          } else {
             console.error(`[API /github/copy-files] Unknown error putting file ${filePath} to target branch:`, err);
          }
          copyResults.push({ path: filePath, status: 'error', reason: message });
          overallSuccess = false; // Mark overall success as false if any error occurs
      }
    } // End loop over paths

    console.log('[API /github/copy-files] Finished processing paths.');

    // --- Auto Tagging Logic (After Loop) --- 
    let tagResult: { success: boolean; error?: string } = { success: false, error: 'Tagging skipped: No successful file copies resulted in a commit.' };
    let finalMessage = 'File copy process completed.';
    let finalStatus = 200;
    let newTagName: string | null = null;

    if (lastSuccessfulCommitSha && someFilesCopied) { // Only tag if something was actually copied/updated
        console.log(`[API /github/copy-files] Attempting to tag last successful commit: ${lastSuccessfulCommitSha}`);
        try {
            const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
            const tagsResponse = await axios.get(tagsUrl, { headers: githubAuthHeaders }); 
            const latestTag = getLatestSemanticTag(tagsResponse.data);
            newTagName = incrementVersion(latestTag, 'patch'); // Force patch bump for copies
            console.log(`[API /github/copy-files] Calculated next tag: ${newTagName}`);
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
            console.error('[API /github/copy-files] Error during tag lookup/creation:', message);
            tagResult.error = message;
        }

        // Adjust final message and status based on tagging outcome
        if (tagResult.success) {
             finalMessage = `Files copied successfully. New state tagged as ${newTagName}.`;
             finalStatus = overallSuccess ? 200 : 207; // Use 207 if there were non-blocking errors earlier
        } else {
             finalMessage = `Files copied (with potential errors/skips), but failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
             finalStatus = 207; // Partial success
        }
    } else if (someFilesCopied) {
        // Files copied, but no commit SHA captured (shouldn't happen ideally) or tagging skipped
        finalMessage = 'File copy process completed, but automatic tagging was skipped.';
        finalStatus = overallSuccess ? 200 : 207;
    } else {
        // No successful commits to tag OR nothing was copied
        finalMessage = 'File copy process completed, but no files were successfully copied/updated.';
        finalStatus = overallSuccess ? 200 : 400; // Use 400 if errors occurred, 200 if only skips
    }
    // --- End Auto Tagging Logic ---

    console.log(`[API /github/copy-files] Responding with status: ${finalStatus}, Message: ${finalMessage}`);
    // Respond with combined results and tagging info
    return NextResponse.json({ 
        success: overallSuccess && tagResult.success, // Overall success depends on copy AND tag (if attempted)
        message: finalMessage,
        results: copyResults,
        ...(tagResult.error && { tagError: tagResult.error }), // Include tagError only on actual failure
        ...(tagResult.success && { tag: newTagName })
    }, { status: finalStatus });

  } catch (error: unknown) {
    // Catch unexpected errors during the loop setup or final response generation
    let message = 'Unexpected server error during copy process.';
    if (error instanceof Error) {
       message = error.message;
    }
    console.error('[API /github/copy-files] Unexpected error during copy process:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}