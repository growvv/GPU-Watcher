import { NextResponse } from 'next/server';

import '@/server/bootstrap';
import { getStore } from '@/server/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hostId = searchParams.get('hostId');
  const gpuIndexParam = searchParams.get('gpuIndex');
  const windowHours = Number(searchParams.get('windowHours') ?? '6');

  if (!hostId || gpuIndexParam === null) {
    return NextResponse.json(
      { error: 'hostId and gpuIndex are required' },
      { status: 400 },
    );
  }

  const gpuIndex = Number(gpuIndexParam);
  const since = Date.now() - windowHours * 60 * 60 * 1000;

  const store = getStore();
  const rows = store.listSnapshots(hostId, gpuIndex, since);

  const points = rows.map((row) => ({
    timestamp: row.collectedAt,
    utilizationPct: row.utilizationPct,
    memoryPct:
      row.memoryTotalMb > 0 ? row.memoryUsedMb / row.memoryTotalMb : 0,
    temperatureC: row.temperatureC,
  }));

  return NextResponse.json({ points });
}
