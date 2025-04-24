import { NextResponse } from 'next/server';
import {
    getBranchHeadSha,
    getTree
} from '@/lib/server/github'; // Adjust path @/ if src is not root

export const dynamic = 'force-dynamic'; // Revalidate on every request

interface TreeItem {
    path: string;
    mode: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
    url?: string;
}

// CORS Headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // Allow all origins (adjust for production)
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * GET /api/github/folder-structure
 * Returns directory structure for a folder (requires branch in query).
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const branch = searchParams.get('branch');
    const folderPath = searchParams.get('path') || ''; // Default to root

    console.log(`[API /github/folder-structure] Fetching structure for branch: ${branch}, path: ${folderPath || '/'}`);

    if (!branch) {
        console.log('[API /github/folder-structure] Error: Missing branch parameter.');
        return NextResponse.json({ error: 'Missing required query parameter: branch' }, { status: 400, headers: corsHeaders });
    }

    try {
        // 1. Get the latest commit SHA for the branch
        const latestCommitSha = await getBranchHeadSha(branch);

        // 2. Get the recursive tree for that commit
        const tree: TreeItem[] = await getTree(latestCommitSha, true); // Pass true for recursive

        // 3. Filter results based on the requested path
        let filteredTree: TreeItem[];
        if (folderPath === '') {
            // If requesting root, return the whole tree
            filteredTree = tree;
            console.log(`[API /github/folder-structure] Found ${tree.length} total items, returning all for root.`);
        } else {
            // If requesting a subfolder, filter by path prefix
            const normalizedFolderPath = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
            filteredTree = tree.filter(
                item => item.path.startsWith(normalizedFolderPath)
            );
            console.log(`[API /github/folder-structure] Found ${tree.length} total items, returning ${filteredTree.length} items under '${folderPath}'`);
        }

        return NextResponse.json(filteredTree, { headers: corsHeaders });

    } catch (error: unknown) {
        // Check if error is an instance of Error before accessing message
        if (error instanceof Error) {
            console.error("[API /github/folder-structure] Error fetching folder structure:", error.message);
        } else {
             console.error("[API /github/folder-structure] Unknown error type fetching folder structure:", error);
        }
        let status = 500;
        let errorMessage = 'Failed to fetch directory structure from GitHub.';

        // We primarily rely on the helper functions (getBranchHeadSha, getTree) to throw specific errors.
        // Check the error message content for common issues.
        if (error instanceof Error) {
            errorMessage = error.message;
            // Distinguish between branch not found vs other errors
            if (errorMessage.includes('not found') || errorMessage.includes('404')) {
                status = 404;
                errorMessage = `Branch '${branch}' or its commit/tree not found.`;
            }
            console.error("[API /github/folder-structure] Error fetching folder structure:", errorMessage);
        }

        // Distinguish between branch not found vs other errors
        return NextResponse.json({ error: errorMessage }, { status, headers: corsHeaders });
    }
}

// Handle OPTIONS requests for CORS preflight
export async function OPTIONS(request: Request) {
    return new NextResponse(null, { headers: corsHeaders });
}