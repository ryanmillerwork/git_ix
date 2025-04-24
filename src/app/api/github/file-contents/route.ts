import { NextResponse } from 'next/server';
import axios from 'axios';
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
        const contentBase64 = response.data.content.replace(/\n/g, ''); // Remove potential newlines
        const buffer = Buffer.from(contentBase64, 'base64');
        const fileContent = buffer.toString('utf8');

        console.log(`[API /github/file-contents] Successfully retrieved content for ${filePath}`);
        return NextResponse.json({ content: fileContent });

    } catch (error: any) {
        console.error(`[API /github/file-contents] Error retrieving file contents for ${filePath} on branch ${branch}:`, error.response?.data || error.message);
        const status = error.response?.status || 500;
        const errorMessage = error.response?.data?.message || 'Error retrieving file contents from GitHub.';
        // Special handling for 404
        if (status === 404) {
             return NextResponse.json({ error: `File not found: ${filePath} on branch ${branch}` }, { status: 404 });
        }
        return NextResponse.json({ error: errorMessage }, { status });
    }
} 