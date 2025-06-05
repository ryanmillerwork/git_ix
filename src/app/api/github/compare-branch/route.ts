import { NextResponse } from 'next/server';
import axios from 'axios';
import {
    GITHUB_API_BASE,
    GITHUB_OWNER,
    GITHUB_REPO,
    githubAuthHeaders
} from '@/lib/server/github';

export async function GET(request: Request) {
  if (!GITHUB_OWNER || !GITHUB_REPO) {
    return NextResponse.json(
      { error: 'GitHub owner or repo is not configured in environment variables.' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const branch = searchParams.get('branch');
  const baseBranch = searchParams.get('base') || 'main';

  if (!branch) {
    return NextResponse.json({ error: 'Branch parameter is required' }, { status: 400 });
  }

  if (branch === baseBranch) {
    return NextResponse.json({ files: [] });
  }

  try {
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/compare/${baseBranch}...${branch}`;
    const response = await axios.get(url, { headers: githubAuthHeaders });

    const differingFiles = response.data.files?.map((file: { filename: string }) => file.filename) || [];
    return NextResponse.json({ files: differingFiles });
  } catch (error: any) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
        // If the branch is new, it might not be comparable yet, which results in a 404.
        // In this case, we can probably assume there are no diffs with main yet.
        return NextResponse.json({ files: [] });
    }
    console.error('Error comparing branches:', error);
    return NextResponse.json({ error: 'Failed to compare branches' }, { status: 500 });
  }
} 