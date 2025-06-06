import { NextResponse } from 'next/server';
import axios from 'axios';
import { 
    GITHUB_API_BASE, 
    GITHUB_OWNER, 
    GITHUB_REPO, 
    githubAuthHeaders 
} from '@/lib/server/github';

export const dynamic = 'force-dynamic';

interface TreeItem {
  path: string;
  sha: string;
  mode: string;
  type: string;
}

interface FileDifference {
  filename: string;
  status: 'added' | 'removed' | 'modified';
  main_sha?: string;
  branch_sha?: string;
}

/**
 * GET /api/github/compare-with-main?branch=<branch_name>
 * Compares a branch with main by comparing tree blob SHAs to find actual current state differences.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const branch = searchParams.get('branch');

  if (!branch) {
    return NextResponse.json({ error: 'Branch parameter is required' }, { status: 400 });
  }

  try {
    // Get main branch tree
    const mainBranchResponse = await axios.get(
      `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches/main`, 
      { headers: githubAuthHeaders }
    );
    const mainCommitSha = mainBranchResponse.data.commit.sha;

    // Get target branch tree
    const branchResponse = await axios.get(
      `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches/${encodeURIComponent(branch)}`, 
      { headers: githubAuthHeaders }
    );
    const branchCommitSha = branchResponse.data.commit.sha;

    // Get recursive trees for both branches
    const [mainTreeResponse, branchTreeResponse] = await Promise.all([
      axios.get(
        `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${mainCommitSha}?recursive=1`, 
        { headers: githubAuthHeaders }
      ),
      axios.get(
        `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/trees/${branchCommitSha}?recursive=1`, 
        { headers: githubAuthHeaders }
      )
    ]);

    const mainTree: TreeItem[] = mainTreeResponse.data.tree;
    const branchTree: TreeItem[] = branchTreeResponse.data.tree;

    // Create maps for fast lookup
    const mainFiles = new Map<string, TreeItem>();
    const branchFiles = new Map<string, TreeItem>();

    // Only include blob types (files), not trees (directories)
    mainTree.filter(item => item.type === 'blob').forEach(item => {
      mainFiles.set(item.path, item);
    });

    branchTree.filter(item => item.type === 'blob').forEach(item => {
      branchFiles.set(item.path, item);
    });

    const differences: FileDifference[] = [];

    // Find all unique file paths
    const allPaths = new Set([...mainFiles.keys(), ...branchFiles.keys()]);

    for (const path of allPaths) {
      const mainFile = mainFiles.get(path);
      const branchFile = branchFiles.get(path);

      if (!mainFile && branchFile) {
        // File added in branch
        differences.push({
          filename: path,
          status: 'added',
          branch_sha: branchFile.sha
        });
      } else if (mainFile && !branchFile) {
        // File removed in branch
        differences.push({
          filename: path,
          status: 'removed',
          main_sha: mainFile.sha
        });
      } else if (mainFile && branchFile && mainFile.sha !== branchFile.sha) {
        // File modified in branch
        differences.push({
          filename: path,
          status: 'modified',
          main_sha: mainFile.sha,
          branch_sha: branchFile.sha
        });
      }
      // If mainFile.sha === branchFile.sha, files are identical - no difference
    }

    // Convert to format compatible with existing UI
    const diff_with_main = differences.map(diff => ({
      filename: diff.filename,
      status: diff.status,
      additions: diff.status === 'added' ? 1 : 0, // Simplified - we don't have line-level data
      deletions: diff.status === 'removed' ? 1 : 0,
      changes: diff.status === 'modified' ? 1 : 0,
      main_sha: diff.main_sha,
      branch_sha: diff.branch_sha
    }));

    return NextResponse.json({ diff_with_main });
  } catch (error: unknown) {
    let message = `An unexpected error occurred while comparing branch '${branch}' with main.`;
    let status = 500;

    if (axios.isAxiosError(error)) {
        console.error(`[API /github/compare-with-main] AxiosError comparing branch '${branch}':`, error.response?.data || error.message);
        if (error.response?.status === 404) {
            message = `Either branch '${branch}' or the main branch was not found.`;
            status = 404;
        } else {
            message = error.response?.data?.message || error.message;
            status = error.response?.status || 500;
        }
    } else if (error instanceof Error) {
        console.error(`[API /github/compare-with-main] Error comparing branch '${branch}':`, error.message);
        message = error.message;
    } else {
        console.error(`[API /github/compare-with-main] Unknown error comparing branch '${branch}':`, error);
    }
    
    return NextResponse.json({ error: message }, { status });
  }
} 