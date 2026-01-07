import { NextResponse } from 'next/server';

import { getHosts } from '@/config/hosts';
import { getRuntimeConfig } from '@/config/runtime';
import '@/server/bootstrap';
import { getStore } from '@/server/store';
import { isTelegramConfigured } from '@/server/telegram';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = getStore();
  const runtimeConfig = getRuntimeConfig();

  const hostStatuses = store.listHostStatuses();
  const gpuStatuses = store.listGpuStatuses();
  const processDisplayMinMemoryMb = Number(
    process.env.GPU_PROCESS_MIN_MEMORY_MB ?? 64,
  );

  return NextResponse.json({
    hosts: hostStatuses,
    gpus: gpuStatuses,
    config: {
      telegramConfigured: isTelegramConfigured(),
      pollIntervalMs: runtimeConfig.pollIntervalMs,
      idleWindow: runtimeConfig.idleWindow,
      idleThreshold: runtimeConfig.idleThreshold,
      chartWindowHours: runtimeConfig.chartWindowHours,
      processDisplayMinMemoryMb,
      hostDefinitions: getHosts().map((host) => ({
        id: host.id,
        label: host.label,
      })),
    },
  });
}
