import { NextResponse } from 'next/server';
import axios, { AxiosError } from 'axios';
import { 
    GITHUB_API_BASE, 
    GITHUB_OWNER, 
    GITHUB_REPO, 
    githubAuthHeaders 
} from '@/lib/server/github'; // Adjust path as needed
import { validateUser } from '@/lib/server/auth'; // Adjust path as needed
import { hasInvalidNameChars } from '@/lib/server/utils'; // Adjust path as needed

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
 * POST /api/github/add-folder
 * Creates a new folder by adding a .gitkeep file (no tagging).
 */
export async function POST(request: Request) {
  console.log('[API /github/add-folder] Received request');
  let body;
  try {
    body = await request.json();
     console.log('[API /github/add-folder] Request body parsed:', { 
         user: body?.username, 
         branch: body?.branch, 
         path: body?.path, 
         foldername: body?.foldername 
     });
  } catch (e) {
    console.error('[API /github/add-folder] Error parsing request body:', e);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password, branch, path, foldername } = body;

  // --- Validation ---
  if (!username || !password || !branch || !foldername || !path) { 
    console.log('[API /github/add-folder] Validation failed: Missing required fields.');
    return NextResponse.json({ error: 'Missing required fields: username, password, branch, path, foldername' }, { status: 400 });
  }
  // Basic foldername validation
  if (hasInvalidNameChars(foldername)) {
       console.log(`[API /github/add-folder] Validation failed: Invalid foldername '${foldername}'.`);
    return NextResponse.json({ error: 'Invalid foldername: cannot contain slashes.' }, { status: 400 });
  }

  // Validate user credentials and branch access
  console.log(`[API /github/add-folder] Validating user ${username} for branch ${branch}...`);
  const validationResult = await validateUser(username, password, branch);
  if (!validationResult.valid) {
     console.log(`[API /github/add-folder] User validation failed: ${validationResult.reason}`);
    return NextResponse.json({ error: validationResult.reason }, { status: 403 });
  }
   console.log(`[API /github/add-folder] User ${username} validated.`);

  // --- GitHub API Interaction ---
  // Path to the .gitkeep file within the new folder
  const gitkeepPath = `${path}/${foldername}/.gitkeep`; 
  const folderCheckPath = `${path}/${foldername}`; // Path to check if folder exists
  const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${gitkeepPath}`;
  let newCommitData: GitHubCommitResponseCommit | null = null;

  try {
    // 1. Check if the folder path already exists
    try {
        console.log(`[API /github/add-folder] Checking for existing folder: ${folderCheckPath} on ${branch}`);
      // Check the directory path itself, not the .gitkeep path yet
      await axios.get(`${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${folderCheckPath}?ref=${encodeURIComponent(branch)}`, { headers: githubAuthHeaders });
      // If the GET succeeds, the folder (or a file with the same name) exists
      console.log(`[API /github/add-folder] Conflict: Folder/file already exists at ${folderCheckPath}`);
      return NextResponse.json({ error: `Folder or file already exists at path: ${folderCheckPath} on branch ${branch}` }, { status: 409 }); // 409 Conflict
    } catch (getError: unknown) {
       // Expecting 404 if folder doesn't exist, proceed if so
       // Type guard for AxiosError
       if (axios.isAxiosError(getError)) {
           if (getError.response?.status !== 404) {
               console.error(`[API /github/add-folder] Error checking for existing folder ${folderCheckPath}:`, getError.response?.data || getError.message);
               throw new Error('Failed to check if folder exists before creation.'); // Rethrow unexpected errors
           }
            // Path not found (404), good to proceed with creation
           console.log(`[API /github/add-folder] Path ${folderCheckPath} does not exist on branch ${branch}. Proceeding with folder creation.`);
       } else {
           // Handle non-Axios errors or rethrow
           console.error(`[API /github/add-folder] Non-Axios error checking for existing folder ${folderCheckPath}:`, getError);
           throw new Error('An unexpected error occurred while checking folder existence.');
       }
    }

    // 2. Attempt to create the .gitkeep file via PUT
    console.log(`[API /github/add-folder] Attempting to create folder placeholder: ${gitkeepPath} on branch ${branch}`);
    const contentBase64 = Buffer.from('# Empty directory placeholder').toString('base64'); // Optional content
    const commitMessage = `Create folder: ${path}/${foldername} [author: ${username}]`;
    const payload = {
        message: commitMessage,
        content: contentBase64,
        branch: branch,
        // No SHA when creating
    };

    const commitResponse = await axios.put(url, payload, { headers: githubAuthHeaders });
    newCommitData = commitResponse.data?.commit;
    if (!newCommitData) {
        throw new Error('Invalid commit response from GitHub after creating .gitkeep.');
    }
    console.log(`[API /github/add-folder] Folder placeholder '${gitkeepPath}' created successfully. Commit SHA: ${newCommitData.sha}`);

    // 3. Respond with success - No tagging for folder creation
    return NextResponse.json({ 
        success: true, 
        message: `Folder '${foldername}' created successfully in '${path}'.`, 
        commit: newCommitData 
    }, { status: 201 }); // 201 Created

  } catch (error: unknown) {
    let status = 500;
    let errorMessage = 'Failed to create folder on GitHub.';

    if (axios.isAxiosError(error)) {
        console.error(`[API /github/add-folder] Axios error creating folder '${path}/${foldername}' on branch '${branch}':`, error.response?.data || error.message);
        status = error.response?.status || 500;
        errorMessage = error.response?.data?.message || error.message || errorMessage;

        // Check for specific GitHub errors if needed
        if (status === 409 || (status === 422 && error.response?.data?.message?.includes('sha'))) {
            // 422 with SHA message usually indicates the file already exists (race condition maybe)
            return NextResponse.json({ error: `Conflict: Folder '${path}/${foldername}' might already exist or have been created concurrently.` }, { status: 409 });
        }
    } else if (error instanceof Error) {
         console.error(`[API /github/add-folder] Error creating folder '${path}/${foldername}' on branch '${branch}':`, error.message);
         errorMessage = error.message;
    } else {
         // Fallback for non-Error types
         console.error(`[API /github/add-folder] Unexpected error creating folder '${path}/${foldername}' on branch '${branch}':`, error);
    }
    
    return NextResponse.json({ error: errorMessage }, { status });
  }
} 