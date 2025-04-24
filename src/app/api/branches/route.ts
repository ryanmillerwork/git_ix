import { NextResponse } from 'next/server';
import axios from 'axios'; // Import axios

// Environment variables for GitHub access (ensure these are set in your .env file or environment)
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Personal Access Token
const GITHUB_API_BASE = process.env.GITHUB_API_BASE || 'https://api.github.com'; // Default if not set

export async function GET(request: Request) {
  console.log('GET /api/branches called - Fetching from GitHub');

  // Check if required environment variables are set
  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN) {
    console.error('GitHub environment variables (GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN) are not set.');
    return NextResponse.json({ error: 'Server configuration error: Missing GitHub credentials.' }, { status: 500 });
  }

  try {
    const url = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/branches`;
    const githubHeaders = {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
    };

    console.log(`Fetching branches from: ${url}`);
    const response = await axios.get(url, { headers: githubHeaders });

    // Important: Wrap the GitHub response array in the { branches: ... } structure
    return NextResponse.json({ branches: response.data });

  } catch (error: any) {
    console.error('Error fetching branches from GitHub:', error.response?.data || error.message);
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || 'Failed to fetch branches from GitHub';
    return NextResponse.json({ error: message }, { status });
  }
} 