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
import { getLatestSemanticTag, incrementVersion, hasInvalidNameChars } from '@/lib/server/utils'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

interface UploadFile {
    name: string;
    content: string; // Base64 encoded
}

interface UploadResult {
    name: string;
    path: string;
    status: 'created' | 'updated' | 'error' | 'skipped';
    reason?: string;
    sha?: string;
    url?: string;
}

/**
 * POST /api/github/upload-files
 * Upload multiple files to a specified directory, applies patch tag.
 */
export async function POST(request: Request) {
  console.log('[API /github/upload-files] Received request');
  let body;
  try {
    body = await request.json();
    console.log('[API /github/upload-files] Request body parsed:', { 
        user: body?.username, 
        branch: body?.branch, 
        targetDir: body?.targetDirectory,
        fileCount: Array.isArray(body?.files) ? body.files.length : 0
    });
  } catch (e) {
    console.error('[API /github/upload-files] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password, branch, targetDirectory, files } = body;

  // --- Validation ---
  if (!username || !password || !branch || targetDirectory === undefined || !Array.isArray(files) || files.length === 0) {
      console.log('[API /github/upload-files] Validation failed: Missing required fields.');
    return NextResponse.json({
        error: 'Missing required fields: username, password, branch, targetDirectory, and a non-empty files array are required.',
    }, { status: 400 });
  }
  if (!files.every((f: any) => typeof f.name === 'string' && typeof f.content === 'string' && f.name && !hasInvalidNameChars(f.name))) {
      console.log('[API /github/upload-files] Validation failed: Invalid file data in array.');
       return NextResponse.json({ error: 'Invalid file data in array. Each file must have a valid name (no slashes) and base64 content.' }, { status: 400 });
  }

  // Validate user credentials and branch access
   console.log(`[API /github/upload-files] Validating user ${username} for branch ${branch}...`);
  const validationResult = await validateUser(username, password, branch);
  if (!validationResult.valid) {
       console.log(`[API /github/upload-files] User validation failed: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }
   console.log(`[API /github/upload-files] User ${username} validated.`);

  // --- GitHub API Interaction --- 
  const uploadResults: UploadResult[] = [];
  let lastSuccessfulCommitSha: string | null = null; 
  let someUploadsSucceeded = false;

  console.log(`[API /github/upload-files] Starting upload for ${files.length} files to ${branch}:${targetDirectory} by ${username}`);

  try {
    for (const file of files as UploadFile[]) { // Type cast here
        const filePath = targetDirectory ? `${targetDirectory}/${file.name}` : file.name;
        const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`;
        const commitMessage = `Upload file: ${filePath} [author: ${username}]`;

        let currentSha: string | null = null;
        // 1. Check if file exists to get SHA for overwrite
        try {
            console.log(`[API /github/upload-files] Checking existing file: ${filePath}`);
            const getResp = await axios.get(`${url}?ref=${encodeURIComponent(branch)}`, { headers: githubAuthHeaders }); 
            currentSha = getResp.data.sha;
            console.log(`[API /github/upload-files] File exists, SHA: ${currentSha}. Will overwrite.`);
        } catch (err: unknown) {
            if (axios.isAxiosError(err)) {
                if (err.response?.status !== 404) {
                     console.error(`[API /github/upload-files] Error checking file ${filePath}:`, err.response?.data || err.message);
                     // Record error and skip this file
                     uploadResults.push({ name: file.name, path: filePath, status: 'error', reason: `Failed to check existing file: ${err.response?.data?.message || err.message}` });
                     continue; 
                }
                console.log(`[API /github/upload-files] File does not exist. Will create.`);
            }
        }

        // 2. Prepare payload and PUT file
        const putPayload = {
            message: commitMessage,
            content: file.content, // Assuming already base64 from client
            branch: branch,
            ...(currentSha ? { sha: currentSha } : {}), 
        };

        try {
            console.log(`[API /github/upload-files] Uploading ${filePath}...`);
            const putResp = await axios.put(url, putPayload, { headers: githubAuthHeaders }); 
            const commitSha = putResp.data?.commit?.sha; 
            if (!commitSha) {
                throw new Error('Missing commit SHA in PUT response.');
            }
            lastSuccessfulCommitSha = commitSha; // Update last successful SHA
            someUploadsSucceeded = true;
            uploadResults.push({
                name: file.name,
                path: filePath,
                status: currentSha ? 'updated' : 'created',
                sha: lastSuccessfulCommitSha ?? undefined,
                url: putResp.data?.content?.html_url,
            });
            console.log(`[API /github/upload-files] Upload successful for ${filePath}. Commit SHA: ${lastSuccessfulCommitSha}`);
        } catch (putError: unknown) {
            let message = 'Upload failed';
            if (axios.isAxiosError(putError)) {
                console.error(`[API /github/upload-files] Axios Error uploading ${filePath}:`, putError.response?.data || putError.message);
                message = putError.response?.data?.message || putError.message || message;
            } else if (putError instanceof Error) {
                 console.error(`[API /github/upload-files] Error uploading ${filePath}:`, putError.message);
                 message = putError.message;
            } else {
                 console.error(`[API /github/upload-files] Unknown error uploading ${filePath}:`, putError);
            }
            uploadResults.push({
                name: file.name,
                path: filePath,
                status: 'error',
                reason: message,
            });
        }
    } // End loop

    console.log('[API /github/upload-files] Finished processing all files.');

    // --- Auto Tagging --- 
    let newTagName: string | null = null;
    let tagResult: { success: boolean; error?: string } = { success: false, error: 'Tagging skipped (no successful uploads or tagging failed).' };
    
    if (lastSuccessfulCommitSha) { // Only tag if at least one upload succeeded
        console.log(`[API /github/upload-files] Attempting to tag last commit: ${lastSuccessfulCommitSha}`);
        try {
            const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
            console.log('[API /github/upload-files] Fetching existing tags for auto-bump...');
            const tagsResponse = await axios.get(tagsUrl, { headers: githubAuthHeaders }); 
            const latestTag = getLatestSemanticTag(tagsResponse.data);
            console.log(`[API /github/upload-files] Latest tag found: ${latestTag || 'None'}`);
            newTagName = incrementVersion(latestTag, 'patch'); 
            console.log(`[API /github/upload-files] Calculated next tag (patch): ${newTagName}`);

            if (newTagName) {
                tagResult = await createTagReference(newTagName, lastSuccessfulCommitSha); 
            } else {
                tagResult.error = 'Could not calculate new tag name.';
            }
        } catch (tagErr: unknown) {
          let message = 'Error processing existing tags.';
          if (axios.isAxiosError(tagErr)) {
            const respData = tagErr.response?.data as { message?: string } | undefined;
            message = respData?.message ?? tagErr.message;
            console.error(`[API /github/upload-files] AxiosError during tag lookup:`, message);
          } else if (tagErr instanceof Error) {
            message = tagErr.message;
            console.error(`[API /github/upload-files] Error during tag lookup:`, message);
          } else {
            console.error(`[API /github/upload-files] Unknown error during tag lookup:`, tagErr);
          }
          tagResult.error = message;
        }
    } else {
        console.log('[API /github/upload-files] Skipping tagging as no successful uploads occurred.');
        tagResult.error = 'Skipped tagging: No successful uploads.';
    }

    // --- Determine Response --- 
    const errors = uploadResults.filter(r => r.status === 'error');
    let finalStatus = 200;
    let finalMessage = `Upload process completed.`;
    let overallSuccess = errors.length === 0;

    if (errors.length === files.length) {
         finalStatus = 500; // Or maybe 400 if all failed due to client-side issues?
         finalMessage = `Upload failed for all files.`;
    } else if (errors.length > 0) {
         finalStatus = 207; // Partial success
         finalMessage = `Upload partially completed with ${errors.length} error(s).`;
    } else {
        // All succeeded (or skipped)
        finalMessage = `All ${uploadResults.filter(r => r.status !== 'error').length} file(s) processed successfully.`;
        if (!someUploadsSucceeded) {
             finalMessage = `Upload processed, but no files needed creating or updating.`
        }
    }
    
    // Append tagging info
    if (lastSuccessfulCommitSha) { // If tagging was attempted
        if(tagResult.success) {
            finalMessage += ` New state tagged as ${newTagName}.`;
            // Keep status 200 or 207 based on upload errors
        } else {
             finalMessage += ` Failed to apply patch tag ${newTagName || ''}. Reason: ${tagResult.error}`;
             if (finalStatus === 200) finalStatus = 207; // Downgrade to partial success if uploads were ok but tag failed
             overallSuccess = false; // Overall is not success if tag failed
        }
    }

    console.log(`[API /github/upload-files] Responding with status: ${finalStatus}`);
    return NextResponse.json({ 
        success: overallSuccess, 
        message: finalMessage, 
        results: uploadResults,
        ...(tagResult.success && { tag: newTagName }),
        ...(tagResult.error && !tagResult.success && { tagError: tagResult.error }) // Only include error if tag failed
    }, { status: finalStatus });

  } catch (err: unknown) {
      let message = 'An unexpected server error occurred during the upload process.';
      if (err instanceof Error) {
          message = err.message;
          console.error('[API /github/upload-files] Unexpected Error:', message);
      } else if (axios.isAxiosError(err)) {
           const respData = err.response?.data as { message?: string } | undefined;
           message = respData?.message ?? err.message;
           console.error('[API /github/upload-files] Unexpected AxiosError:', message);
      } else {
           console.error('[API /github/upload-files] Unexpected unknown error:', err);
      }
      return NextResponse.json({ error: message }, { status: 500 });
  }
}