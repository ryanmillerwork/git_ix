import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  // Placeholder: Implement logic to fetch branches later
  console.log('GET /api/branches called');
  try {
    // Replace with actual logic to get branches from GitHub or your source
    const branches = ['main', 'develop', 'feature/some-feature']; // Example data

    return NextResponse.json({ branches });
  } catch (error) {
    console.error('Error fetching branches:', error);
    return NextResponse.json({ error: 'Failed to fetch branches' }, { status: 500 });
  }
} 