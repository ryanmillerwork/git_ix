import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  // Placeholder: Implement logic to fetch branches later
  console.log('GET /api/branches called');
  try {
    // Placeholder: Replace with actual logic to get branches later
    const placeholderBranches = [
      { name: 'main', commit: { sha: 'abc', url: '...' }, protected: true },
      { name: 'develop', commit: { sha: 'def', url: '...' }, protected: false },
      { name: 'feature/some-feature', commit: { sha: 'ghi', url: '...' }, protected: false },
      { name: 'old-feature-retired', commit: { sha: 'jkl', url: '...' }, protected: false },
    ];

    return NextResponse.json({ branches: placeholderBranches }); // Return object with branches key
  } catch (error) {
    console.error('Error fetching branches:', error);
    return NextResponse.json({ error: 'Failed to fetch branches' }, { status: 500 });
  }
} 