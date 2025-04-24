import { NextResponse } from 'next/server';
import axios, { AxiosError } from 'axios';
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

/**
 * POST /api/github/add-file
 * Creates a new blank file in a specified branch and path, applies patch tag.
 */
export async function POST(request: Request) {
  console.log('[API /github/add-file] Received request');
  let body;
  try {
    body = await request.json();
     console.log('[API /github/add-file] Request body parsed:', { 
         user: body?.username, 
         branch: body?.branch, 
         path: body?.path, 
         filename: body?.filename 
     });
  } catch (e) {
    console.error('[API /github/add-file] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password, branch, path, filename } = body;
  const fullPath = path ? `${path}/${filename}` : filename; // Construct full path

  // --- Validation ---
  if (!username || !password || !branch || !filename) {
    console.log('[API /github/add-file] Validation failed: Missing required fields.');
    return NextResponse.json({ error: 'Missing required fields: username, password, branch, filename (path is optional)' }, { status: 400 });
  }
   // Basic filename validation
   if (hasInvalidNameChars(filename)) {
        console.log(`[API /github/add-file] Validation failed: Invalid filename '${filename}'.`);
       return NextResponse.json({ error: 'Invalid filename: cannot contain slashes.' }, { status: 400 });
   }

  // Validate user credentials and branch access
  console.log(`[API /github/add-file] Validating user ${username} for branch ${branch}...`);
  const validationResult = await validateUser(username, password, branch);
  if (!validationResult.valid) {
     console.log(`[API /github/add-file] User validation failed: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }
   console.log(`[API /github/add-file] User ${username} validated.`);

  // --- GitHub API Interaction ---
  const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${fullPath}`;
  let commitSha: string | null = null;
  let newCommitData: any = null;

  try {
    // 1. Check if file already exists before attempting PUT
    try {
        console.log(`[API /github/add-file] Checking for existing file: ${fullPath} on ${branch}`);
      await axios.get(`${url}?ref=${encodeURIComponent(branch)}`, { headers: githubAuthHeaders });
      // If the GET succeeds, the file exists
      console.log(`[API /github/add-file] Conflict: File already exists at ${fullPath}`);
      return NextResponse.json({ error: `File already exists at path: ${fullPath} on branch ${branch}` }, { status: 409 }); // 409 Conflict
    } catch (getError: unknown) {
       // Expecting 404 if file doesn't exist, proceed if so
       if (axios.isAxiosError(getError)) {
           if (getError.response?.status !== 404) {
               console.error(`[API /github/add-file] Error checking for existing file ${fullPath}:`, getError.response?.data || getError.message);
               throw new Error('Failed to check if file exists before creation.'); // Rethrow unexpected errors
           }
           // File not found (404), good to proceed with creation
           console.log(`[API /github/add-file] File ${fullPath} does not exist on branch ${branch}. Proceeding with creation.`);
       } else {
           // Handle non-Axios errors or rethrow
           console.error(`[API /github/add-file] Non-Axios error checking for existing file ${fullPath}:`, getError);
           throw new Error('An unexpected error occurred while checking file existence.');
       }
    }

    // 2. Commit the new blank file via PUT
    console.log(`[API /github/add-file] Attempting to create file: ${fullPath} on branch ${branch}`);
    const contentBase64 = Buffer.from('').toString('base64'); // Content is an empty string
    const commitMessage = `Add new file: ${fullPath} [author: ${username}]`;
    const payload = {
      message: commitMessage,
      content: contentBase64,
      branch: branch,
      // Do NOT include SHA when creating a new file
    };

    const commitResponse = await axios.put(url, payload, { headers: githubAuthHeaders }); 
    commitSha = commitResponse.data?.commit?.sha;
    newCommitData = commitResponse.data?.commit;
    if (!commitSha || !newCommitData) {
         throw new Error('Invalid commit response from GitHub after file PUT.');
    }
    console.log(`[API /github/add-file] File '${fullPath}' created successfully. Commit SHA: ${commitSha}`);

    // 3. Handle Tagging (Patch Bump)
    let newTagName: string | null = null;
    let tagResult: { success: boolean; error?: string } = { success: false, error: 'Tagging skipped or failed.' };
    try {
        const tagsUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags`;
        console.log('[API /github/add-file] Fetching existing tags for auto-bump...');
        const tagsResponse = await axios.get(tagsUrl, { headers: githubAuthHeaders }); 
        const latestTag = getLatestSemanticTag(tagsResponse.data);
        console.log(`[API /github/add-file] Latest tag found: ${latestTag || 'None'}`);
        
        newTagName = incrementVersion(latestTag, 'patch'); // Force patch bump
        console.log(`[API /github/add-file] Calculated next tag (patch): ${newTagName}`);

        if (newTagName && commitSha) {
            tagResult = await createTagReference(newTagName, commitSha);
        } else {
            tagResult.error = 'Could not calculate new tag name or missing commit SHA.';
        }
    } catch (tagLookupError: unknown) {
        let message = 'Error processing existing tags.';
        if (tagLookupError instanceof Error) {
            message = tagLookupError.message;
        }
        console.error('[API /github/add-file] Error during tag lookup/calculation:', message);
        tagResult.error = message;
    }

    // 4. Respond based on commit and tag results
    let finalMessage = ``;
    let finalStatus = 201; // Default 201 Created

    if (tagResult.success) {
         finalMessage = `File '${fullPath}' created successfully and tagged as ${newTagName}.`;
         finalStatus = 201;
          console.log(`[API /github/add-file] File creation and tagging successful.`);
    } else {
         finalMessage = `File '${fullPath}' created successfully, but failed to create tag ${newTagName || ''}. Reason: ${tagResult.error}`; 
         finalStatus = 207; // Partial success
          console.log(`[API /github/add-file] File creation successful, but tagging failed.`);
    }
    
    return NextResponse.json({ 
        success: true, // File creation itself succeeded
        message: finalMessage, 
        commit: newCommitData, 
        ...(tagResult.success && { tag: newTagName }),
        ...(tagResult.error && { tagError: tagResult.error })
    }, { status: finalStatus });

  } catch (error: unknown) {
    let status = 500;
    let errorMessage = 'Failed to create file on GitHub.';

    if (axios.isAxiosError(error)) {
        console.error(`[API /github/add-file] Axios error creating file '${fullPath}' on branch '${branch}':`, error.response?.data || error.message);
        status = error.response?.status || 500;
        errorMessage = error.response?.data?.message || error.message || errorMessage;

        // Check if it was the PUT call that failed specifically due to conflict (though pre-check should prevent this)
        if (status === 422 && error.response?.data?.message?.includes('sha')) {
            // This specific 422 usually means SHA was provided for a new file OR path conflict
            return NextResponse.json({ error: `Conflict: File '${fullPath}' might have been created concurrently.` }, { status: 409 });
        }
    } else if (error instanceof Error) {
        console.error(`[API /github/add-file] Error creating file '${fullPath}' on branch '${branch}':`, error.message);
        errorMessage = error.message;
    } else {
        // Fallback for non-Error types
        console.error(`[API /github/add-file] Unexpected error creating file '${fullPath}' on branch '${branch}':`, error);
    }

    return NextResponse.json({ error: errorMessage }, { status });
  }
} 