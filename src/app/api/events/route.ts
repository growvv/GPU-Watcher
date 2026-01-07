import { NextResponse } from 'next/server';

import '@/server/bootstrap';
import { getStore } from '@/server/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Number(searchParams.get('limit') ?? '50'),
    200,
  );
  const offset = Number(searchParams.get('offset') ?? '0');

  const store = getStore();
  const events = store.listEvents(limit, offset);

  return NextResponse.json({ events });
}
