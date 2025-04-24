console.log('Loading /api/ping/route.ts'); // Added for debugging

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ping
 * Simple ping endpoint.
 */
export async function GET() {
  console.log('[API /ping] Responding pong');
  return NextResponse.json({ message: 'pong' });
} 