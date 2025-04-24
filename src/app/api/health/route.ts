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
  } catch (error: any) {
    console.error('[API /health] Error:', error);
    return NextResponse.json({ error: 'Health check failed' }, { status: 500 });
  }
}