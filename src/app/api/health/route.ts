console.log('Loading /api/health/route.ts'); // Added for debugging

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // Ensure this route is always executed dynamically

/**
 * GET /api/health
 * Basic health check endpoint.
 */
export async function GET() {
  // This endpoint simply confirms the server is running and responding.
  try {
    const timestamp = new Date().toISOString();
    console.log(`[API /health] Responding OK at ${timestamp}`);
    return NextResponse.json({ status: 'ok', timestamp: timestamp });
  } catch (error: unknown) {
    console.error('[API /health] Error:', error);
    let message = 'Health check failed';
    if (error instanceof Error) {
      message = error.message;
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}