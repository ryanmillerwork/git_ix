import { NextResponse } from 'next/server';
import axios, { AxiosError } from 'axios';
import { 
    GITHUB_API_BASE, 
    GITHUB_OWNER, 
    GITHUB_REPO, 
    githubAuthHeaders 
} from '@/lib/server/github'; // Adjust path as needed

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * GET /api/github/file-contents
 * Returns contents of selected file from GitHub.
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const branch = searchParams.get('branch');
    const filePath = searchParams.get('path');

    console.log(`[API /github/file-contents] Fetching content for path: ${filePath} on branch: ${branch}`);

    // Validate required parameters
    if (!branch) {
        console.log('[API /github/file-contents] Error: Missing branch parameter.');
        return NextResponse.json({ error: 'Branch is required' }, { status: 400 });
    }
    if (!filePath) {
        console.log('[API /github/file-contents] Error: Missing path parameter.');
        return NextResponse.json({ error: 'File path is required' }, { status: 400 });
    }

    try {
        // Construct the GitHub API URL for file contents
        const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
        console.log('[API /github/file-contents] Fetching file from GitHub:', url);
        
        const response = await axios.get(url, { headers: githubAuthHeaders });

        // GitHub returns the file content as a base64-encoded string.
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        return NextResponse.json({ content, sha: response.data.sha });

    } catch (error: unknown) {
        let logMessage = `[API /github/file-contents] Error retrieving file contents for ${filePath} on branch ${branch}:`;
        let detailMessage = 'Unknown error occurred.';
        let status = 500;
        let errorMessage = 'Error retrieving file contents from GitHub.';

        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError<any>; // Added type assertion for better access to response.data
            console.error(logMessage, axiosError.response?.data || axiosError.message);
            status = axiosError.response?.status || 500;
            if (status === 404) {
                errorMessage = `File not found: ${filePath} on branch ${branch}.`;
            } else {
                errorMessage = `GitHub API error (${status}): ${axiosError.response?.data?.message || axiosError.message}`;
            }
        } else if (error instanceof Error) {
            console.error(logMessage, error.message);
            errorMessage = error.message;
        } else {
            console.error(logMessage, error);
            errorMessage = 'An unexpected error occurred during file retrieval.';
        }

        return NextResponse.json({ error: errorMessage }, { status });
    }
} 