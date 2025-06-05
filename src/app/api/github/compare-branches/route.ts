import { NextResponse } from 'next/server';
import axios from 'axios';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const branch = searchParams.get('branch');

  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!branch || branch === 'main') {
    return NextResponse.json({ files: [] });
  }

  if (!owner || !repo || !token) {
    return NextResponse.json({ error: 'GitHub credentials are not configured in environment variables.' }, { status: 500 });
  }

  const compareURL = `https://api.github.com/repos/${owner}/${repo}/compare/main...${branch}`;

  try {
    const response = await axios.get(compareURL, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const differingFiles = response.data.files.map((file: any) => file.filename);

    console.log('Differing files between main and', branch, ':', differingFiles);

    return NextResponse.json({ files: differingFiles });
  } catch (error) {
    console.error(`Error comparing branch ${branch} with main:`, error);
    return NextResponse.json({ error: 'Failed to compare branches.' }, { status: 500 });
  }
} 