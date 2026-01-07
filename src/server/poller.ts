import { getHosts } from '@/config/hosts';
import { collectSnapshotsForHost } from './nvidia';
import { getRuntimeConfig } from '@/config/runtime';
import { getStore } from './store';
import { sendTelegramMessage } from './telegram';
import type { HostConfig, ProcessInfo, SnapshotInput } from './types';

const RETENTION_MS =
  Number(process.env.GPU_SNAPSHOT_RETENTION_MS ?? 1000 * 60 * 60 * 24 * 7); // 7 days
const CLEANUP_INTERVAL_MS = Number(
  process.env.GPU_CLEANUP_INTERVAL_MS ?? 1000 * 60 * 10,
);

declare global {
  var __gpuWatcherPoller: { stop: () => void } | undefined;
}

const store = getStore();

function formatGpuLabel(host: HostConfig, snapshot: SnapshotInput) {
  const hostLabel = host.label ?? host.id;
  return `${hostLabel} · GPU${snapshot.gpuIndex} ${snapshot.gpuName}`;
}

function buildMemoryHistory(
  previous: number[] = [],
  nextValue: number,
  windowSize: number,
) {
  const history = [...previous, nextValue];
  while (history.length > windowSize) {
    history.shift();
  }
  return history;
}

function diffProcesses(
  previous: ProcessInfo[],
  current: ProcessInfo[],
): {
  started: ProcessInfo[];
  stopped: ProcessInfo[];
} {
  const prevMap = new Map(previous.map((proc) => [proc.pid, proc]));
  const currMap = new Map(current.map((proc) => [proc.pid, proc]));

  const started = current.filter((proc) => !prevMap.has(proc.pid));
  const stopped = previous.filter((proc) => !currMap.has(proc.pid));

  return { started, stopped };
}

async function notifyEvent(message: string, eventId: number) {
  const sent = await sendTelegramMessage(message);
  if (sent) {
    store.markEventAsNotified(eventId);
  }
}

async function processSnapshot(
  host: HostConfig,
  snapshot: SnapshotInput,
  idleWindow: number,
  idleThreshold: number,
) {
  const savedSnapshot = store.recordSnapshot(snapshot);
  const previousStatus = store.getGpuStatus(
    snapshot.hostId,
    snapshot.gpuIndex,
  );

  const memoryRatio =
    snapshot.memoryTotalMb > 0
      ? snapshot.memoryUsedMb / snapshot.memoryTotalMb
      : 0;

  const history = buildMemoryHistory(
    previousStatus?.memoryHistory ?? [],
    memoryRatio,
    idleWindow,
  );

  const shouldBootstrapIdle =
    history.length > 0 && history.length < idleWindow;
  const evaluationHistory =
    shouldBootstrapIdle && history.length > 0
      ? [
          ...history,
          ...Array(idleWindow - history.length).fill(
            history[history.length - 1],
          ),
        ]
      : history;
  const meetsIdleCriteria =
    evaluationHistory.length === idleWindow &&
    evaluationHistory.every((value) => value < idleThreshold);
  const wasIdle = previousStatus?.isIdle ?? false;

  let idleSince = previousStatus?.idleSince;

  if (!wasIdle && meetsIdleCriteria) {
    idleSince = snapshot.collectedAt;
    const event = store.insertEvent({
      hostId: snapshot.hostId,
      gpuIndex: snapshot.gpuIndex,
      type: 'gpu_idle_start',
      details: {
        gpuName: snapshot.gpuName,
        idleSince,
        memoryHistory: history,
      },
    });
    notifyEvent(
      `✅ GPU 空闲\n${formatGpuLabel(host, snapshot)}\n已空闲自: ${new Date(
        idleSince,
      ).toLocaleString()}`,
      event.id,
    );
  } else if (wasIdle && !meetsIdleCriteria && previousStatus?.idleSince) {
    const durationMs = snapshot.collectedAt - previousStatus.idleSince;
    store.insertEvent({
      hostId: snapshot.hostId,
      gpuIndex: snapshot.gpuIndex,
      type: 'gpu_idle_end',
      details: {
        gpuName: snapshot.gpuName,
        idleSince: previousStatus.idleSince,
        endedAt: snapshot.collectedAt,
        durationMs,
      },
    });
    idleSince = undefined;
    // No Telegram for end events, but keep for history
  } else if (meetsIdleCriteria && wasIdle && !idleSince) {
    idleSince = snapshot.collectedAt;
  }

  const processDiff = diffProcesses(
    previousStatus?.processes ?? [],
    snapshot.processes,
  );

  for (const proc of processDiff.started) {
    store.insertEvent({
      hostId: snapshot.hostId,
      gpuIndex: snapshot.gpuIndex,
      type: 'process_online',
      details: {
        pid: proc.pid,
        name: proc.name,
        username: proc.username,
        command: proc.command,
        startedAt: proc.startedAt,
        memoryUsedMb: proc.memoryUsedMb,
        parent: proc.parent,
        hostUser: proc.hostUser,
        containerId: proc.containerId,
        containerName: proc.containerName,
        ownerHint: proc.ownerHint,
        ownerSource: proc.ownerSource,
        collectedAt: snapshot.collectedAt,
      },
    });
  }

  for (const proc of processDiff.stopped) {
    store.insertEvent({
      hostId: snapshot.hostId,
      gpuIndex: snapshot.gpuIndex,
      type: 'process_offline',
      details: {
        pid: proc.pid,
        name: proc.name,
        username: proc.username,
        command: proc.command,
        startedAt: proc.startedAt,
        memoryUsedMb: proc.memoryUsedMb,
        parent: proc.parent,
        hostUser: proc.hostUser,
        containerId: proc.containerId,
        containerName: proc.containerName,
        ownerHint: proc.ownerHint,
        ownerSource: proc.ownerSource,
        collectedAt: snapshot.collectedAt,
      },
    });
  }

  store.saveGpuStatus({
    hostId: snapshot.hostId,
    gpuIndex: snapshot.gpuIndex,
    gpuUuid: snapshot.gpuUuid,
    gpuName: snapshot.gpuName,
    memoryTotalMb: snapshot.memoryTotalMb,
    lastMemoryUsedMb: snapshot.memoryUsedMb,
    lastUtilizationPct: snapshot.utilizationPct,
    lastTemperatureC: snapshot.temperatureC,
    lastSnapshotId: savedSnapshot.snapshotId,
    memoryHistory: history,
    isIdle: meetsIdleCriteria,
    idleSince,
    offlineSince: undefined,
    lastSeen: snapshot.collectedAt,
    processes: snapshot.processes,
  });
}

async function handleHostSuccess(
  host: HostConfig,
  snapshots: SnapshotInput[],
  config: { idleWindow: number; idleThreshold: number },
) {
  const previousStatus = store.getHostStatus(host.id);
  const now = Date.now();

  store.saveHostStatus({
    hostId: host.id,
    label: host.label,
    isOnline: true,
    lastSeen: now,
    offlineSince: undefined,
    lastError: undefined,
  });
  store.clearHostOffline(host.id);

  if (previousStatus && !previousStatus.isOnline) {
    store.insertEvent({
      hostId: host.id,
      type: 'host_online',
      details: {
        recoveredAt: now,
      },
    });
  }

  for (const snapshot of snapshots) {
    await processSnapshot(
      host,
      snapshot,
      config.idleWindow,
      config.idleThreshold,
    );
  }
}

async function handleHostError(host: HostConfig, error: Error) {
  const previousStatus = store.getHostStatus(host.id);
  const offlineSince = previousStatus?.offlineSince ?? Date.now();

  store.saveHostStatus({
    hostId: host.id,
    label: host.label,
    isOnline: false,
    lastSeen: previousStatus?.lastSeen,
    offlineSince,
    lastError: error.message,
  });

  store.markHostOffline(host.id, offlineSince);

  if (!previousStatus || previousStatus.isOnline) {
    const event = store.insertEvent({
      hostId: host.id,
      type: 'host_offline',
      details: {
        message: error.message,
        offlineSince,
      },
    });
    notifyEvent(
      `⚠️ 主机离线: ${host.label ?? host.id}\n错误: ${error.message}`,
      event.id,
    );
  }
}

async function pollHost(
  host: HostConfig,
  config: { idleWindow: number; idleThreshold: number },
) {
  try {
    const snapshots = await collectSnapshotsForHost(host);
    await handleHostSuccess(host, snapshots, config);
  } catch (error) {
    await handleHostError(host, error as Error);
  }
}

function createPoller() {
  let running = false;
  let stopped = false;
  let pollTimeout: NodeJS.Timeout | null = null;

  const runCycle = async () => {
    if (running) {
      console.warn('[gpu-watcher] Previous poll cycle still running');
      return;
    }
    running = true;
    try {
      const config = getRuntimeConfig();
      for (const host of getHosts()) {
        if (stopped) {
          break;
        }
        await pollHost(host, {
          idleWindow: config.idleWindow,
          idleThreshold: config.idleThreshold,
        });
      }
    } catch (error) {
      console.error('[gpu-watcher] Poll cycle failed', error);
    } finally {
      running = false;
    }
  };

  const scheduleNext = () => {
    if (stopped) {
      return;
    }
    const delay = getRuntimeConfig().pollIntervalMs ?? 60_000;
    pollTimeout = setTimeout(async () => {
      await runCycle();
      scheduleNext();
    }, delay);
    pollTimeout.unref?.();
  };

  runCycle().finally(scheduleNext);

  const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - RETENTION_MS;
    try {
      store.deleteSnapshotsBefore(cutoff);
    } catch (error) {
      console.error('[gpu-watcher] Cleanup task failed', error);
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupInterval.unref?.();

  return {
    stop() {
      stopped = true;
      if (pollTimeout) {
        clearTimeout(pollTimeout);
      }
      clearInterval(cleanupInterval);
    },
  };
}

export function ensurePoller() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  if (!globalThis.__gpuWatcherPoller) {
    globalThis.__gpuWatcherPoller = createPoller();
  }
  return globalThis.__gpuWatcherPoller;
}
