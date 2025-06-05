import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const branch = searchParams.get('branch');

  if (!branch) {
    return NextResponse.json({ error: 'Branch parameter is required' }, { status: 400 });
  }

  if (branch === 'main') {
    // No differences to report when comparing main to itself
    return NextResponse.json([], { status: 200 });
  }

  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub environment variables are not configured' }, { status: 500 });
  }

  const compareUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/compare/main...${branch}`;

  try {
    const response = await axios.get(compareUrl, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const files = response.data.files || [];
    const differingFiles = files.map((file: { filename: string }) => file.filename);

    // As requested, log the differing files to the console
    console.log(`[GIT_IX_COMPARE] Differing files for branch '${branch}':`, differingFiles);

    return NextResponse.json(differingFiles, { status: 200 });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response && error.response.status === 404) {
      // This can happen if the branch is new and has no common ancestor with main yet.
      // Or if one of the branches does not exist. Treat as a "no diff" scenario for now.
      console.warn(`[GIT_IX_COMPARE] Could not compare branch '${branch}' with main. It might be a new branch.`);
      return NextResponse.json([], { status: 200 });
    }
    
    console.error(`[GIT_IX_COMPARE] Error comparing branches:`, error);
    return NextResponse.json({ error: 'Failed to compare branches' }, { status: 500 });
  }
} 