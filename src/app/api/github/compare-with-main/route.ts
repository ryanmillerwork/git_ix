import { NextResponse } from 'next/server';
import axios from 'axios';
import { 
    GITHUB_API_BASE, 
    GITHUB_OWNER, 
    GITHUB_REPO, 
    githubAuthHeaders 
} from '@/lib/server/github';

export const dynamic = 'force-dynamic';

/**
 * GET /api/github/compare-with-main?branch=<branch_name>
 * Compares a branch with main and returns the list of files that are different.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const branch = searchParams.get('branch');

  if (!branch) {
    return NextResponse.json({ error: 'Branch parameter is required' }, { status: 400 });
  }

  const compareUrl = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/compare/main...${encodeURIComponent(branch)}`;
  
  console.log(`[API /github/compare-with-main] Comparing branch '${branch}' with main.`);
  console.log(`[API /github/compare-with-main] Requesting URL: ${compareUrl}`);

  try {
    const response = await axios.get(compareUrl, { headers: githubAuthHeaders });
    
    const diff_with_main = response.data.files?.map((file: any) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
    }));

    console.log('[API /github/compare-with-main] diff_with_main:', diff_with_main);

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