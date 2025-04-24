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
        return NextResponse.json({ error: 'Missing required query parameter: branch' }, { status: 400 });
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

        return NextResponse.json(filteredTree);

    } catch (error: any) {
        console.error("[API /github/folder-structure] Error fetching folder structure:", error.message);
        // Distinguish between branch not found vs other errors
        if (error.message.includes('not found') || error.message.includes('404')) {
            return NextResponse.json({ error: `Branch '${branch}' or its commit/tree not found.` }, { status: 404 });
        } else {
            return NextResponse.json({ error: 'Failed to fetch directory structure from GitHub.' }, { status: 500 });
        }
    }
}