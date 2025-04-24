import { NextResponse } from 'next/server';
import axios from 'axios';
import {
    GITHUB_API_BASE,
    GITHUB_OWNER,
    GITHUB_REPO,
    githubAuthHeaders
} from '@/lib/server/github'; // Adjust path @/ if src is not root

export const dynamic = 'force-dynamic'; // Revalidate on every request

/**
 * GET /api/github/branches
 * Returns all branches in the configured GitHub repo.
 */
export async function GET() {
  console.log('[API /github/branches] Fetching branches...');
  try {
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches`;
    console.log(`[API /github/branches] Calling GitHub API: ${url}`);
    const response = await axios.get(url, { headers: githubAuthHeaders });

    // Add caching headers if desired - example: cache for 5 minutes
    // const headers = new Headers();
    // headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    // return NextResponse.json(response.data, { headers });

    return NextResponse.json(response.data);

  } catch (error: unknown) {
    let status = 500;
    let errorMessage = 'Failed to fetch branches from GitHub.';

    // @ts-ignore // Temporarily ignore error due to removed import
    if (axios.isAxiosError(error)) {
        console.error('[API /github/branches] Axios error fetching branches:', error.response?.data || error.message);
        status = error.response?.status || 500;
        errorMessage = error.response?.data?.message || errorMessage;
    } else if (error instanceof Error) {
        console.error('[API /github/branches] Error fetching branches:', error.message);
        errorMessage = error.message;
    } else {
        console.error('[API /github/branches] Unexpected error fetching branches:', error);
    }

    return NextResponse.json({ error: errorMessage }, { status });
  }
}