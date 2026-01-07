import '@/server/bootstrap';

import { getHosts } from '@/config/hosts';
import { getRuntimeConfig } from '@/config/runtime';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { getStore } from '@/server/store';
import { isTelegramConfigured } from '@/server/telegram';

export default function HomePage() {
  const store = getStore();
  const configuredHosts = getHosts();
  const runtimeConfig = getRuntimeConfig();

  const initialStatus = {
    hosts: store.listHostStatuses(),
    gpus: store.listGpuStatuses(),
    config: {
      telegramConfigured: isTelegramConfigured(),
      pollIntervalMs: runtimeConfig.pollIntervalMs,
      idleWindow: runtimeConfig.idleWindow,
      idleThreshold: runtimeConfig.idleThreshold,
      chartWindowHours: runtimeConfig.chartWindowHours,
      processDisplayMinMemoryMb: Number(
        process.env.GPU_PROCESS_MIN_MEMORY_MB ?? 64,
      ),
      hostDefinitions: configuredHosts.map((host) => ({
        id: host.id,
        label: host.label,
      })),
    },
  };

  const initialEvents = {
    events: store.listEvents(50, 0),
  };

  return (
    <main className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <Dashboard
        initialStatus={initialStatus}
        initialEvents={initialEvents}
      />
    </main>
  );
}
