import { NextResponse } from 'next/server';

import { getHosts } from '@/config/hosts';
import { getRuntimeConfig } from '@/config/runtime';
import { getStore } from '@/server/store';

const windows = [
  { id: '1d', label: '过去 24 小时', durationMs: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '过去 7 天', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '过去 30 天', durationMs: 30 * 24 * 60 * 60 * 1000 },
];

function clampStart(start: number) {
  return start > 0 ? start : 0;
}

interface SnapshotRow {
  id: number;
  collectedAt: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  utilizationPct: number;
  temperatureC: number;
}

function accumulateGpuStats(
  snapshots: SnapshotRow[],
  start: number,
  end: number,
  idleThreshold: number,
) {
  const ordered = snapshots
    .filter((point) => point.collectedAt <= end)
    .sort((a, b) => a.collectedAt - b.collectedAt);

  if (ordered.length === 0) {
    return {
      usageMs: 0,
      dataMs: 0,
      utilSum: 0,
      memSum: 0,
    };
  }

  let prev: SnapshotRow | null = null;
  let usageMs = 0;
  let dataMs = 0;
  let utilSum = 0;
  let memSum = 0;

  for (const current of ordered) {
    if (current.collectedAt < start) {
      prev = current;
      continue;
    }
    if (!prev) {
      prev = current;
      continue;
    }
    const intervalStart = Math.max(prev.collectedAt, start);
    const intervalEnd = Math.min(current.collectedAt, end);
    if (intervalEnd > intervalStart) {
      const duration = intervalEnd - intervalStart;
      const ratio =
        prev.memoryTotalMb > 0
          ? prev.memoryUsedMb / prev.memoryTotalMb
          : 0;
      if (ratio >= idleThreshold) {
        usageMs += duration;
      }
      dataMs += duration;
      utilSum += (prev.utilizationPct ?? 0) * duration;
      memSum += ratio * duration;
    }
    prev = current;
  }

  if (prev) {
    const intervalStart = Math.max(prev.collectedAt, start);
    const intervalEnd = end;
    if (intervalEnd > intervalStart) {
      const duration = intervalEnd - intervalStart;
      const ratio =
        prev.memoryTotalMb > 0
          ? prev.memoryUsedMb / prev.memoryTotalMb
          : 0;
      if (ratio >= idleThreshold) {
        usageMs += duration;
      }
      dataMs += duration;
      utilSum += (prev.utilizationPct ?? 0) * duration;
      memSum += ratio * duration;
    }
  }

  return { usageMs, dataMs, utilSum, memSum };
}

export async function GET() {
  const store = getStore();
  const hostDefinitions = getHosts();
  const runtime = getRuntimeConfig();
  const idleThreshold = runtime.idleThreshold ?? 0.1;
  const pollInterval = runtime.pollIntervalMs ?? 60_000;
  const now = Date.now();

  const gpuStatuses = store.listGpuStatuses();
  const hostGpuMap = new Map<string, Set<number>>();
  for (const gpu of gpuStatuses) {
    if (!hostGpuMap.has(gpu.hostId)) {
      hostGpuMap.set(gpu.hostId, new Set());
    }
    hostGpuMap.get(gpu.hostId)!.add(gpu.gpuIndex);
  }

  const hostsToReport: Array<{ id: string; label?: string }> =
    hostDefinitions.length > 0
      ? hostDefinitions.map((host) => ({ id: host.id, label: host.label }))
      : Array.from(hostGpuMap.keys()).map((hostId) => ({ id: hostId }));

  const hostStats = hostsToReport.map((host) => {
    const gpuIndices = Array.from(hostGpuMap.get(host.id) ?? []);
    const windowStats: Record<
      string,
      {
        usageMs: number;
        capacityMs: number;
        coverageMs: number;
        usageRatio: number;
        averageUtilizationPct: number;
        averageMemoryPct: number;
      }
    > = {};

    for (const windowDef of windows) {
      const start = now - windowDef.durationMs;
      const end = now;
      const querySince = clampStart(start - pollInterval);
      let usageMs = 0;
      let coverageMs = 0;
      let utilSum = 0;
      let memSum = 0;

      for (const gpuIndex of gpuIndices) {
        const snapshots = store.listSnapshots(host.id, gpuIndex, querySince);
        const stats = accumulateGpuStats(
          snapshots,
          start,
          end,
          idleThreshold,
        );
        usageMs += stats.usageMs;
        coverageMs += stats.dataMs;
        utilSum += stats.utilSum;
        memSum += stats.memSum;
      }

      const totalCapacityMs =
        windowDef.durationMs * Math.max(gpuIndices.length, 1);
      const usageRatio =
        totalCapacityMs > 0 ? usageMs / totalCapacityMs : 0;
      const averageUtilizationPct =
        coverageMs > 0 ? utilSum / coverageMs : 0;
      const averageMemoryPct =
        coverageMs > 0 ? (memSum / coverageMs) * 100 : 0;

      windowStats[windowDef.id] = {
        usageMs,
        capacityMs: totalCapacityMs,
        coverageMs,
        usageRatio,
        averageUtilizationPct,
        averageMemoryPct,
      };
    }

    return {
      hostId: host.id,
      label: host.label ?? host.id,
      gpuCount: gpuIndices.length,
      windows: windowStats,
    };
  });

  const gpuStats = gpuStatuses
    .map((gpu) => {
      const windowStats: Record<
        string,
        {
          usageMs: number;
          capacityMs: number;
          coverageMs: number;
          usageRatio: number;
          averageUtilizationPct: number;
          averageMemoryPct: number;
        }
      > = {};
      for (const windowDef of windows) {
        const start = now - windowDef.durationMs;
        const end = now;
        const querySince = clampStart(start - pollInterval);
        const snapshots = store.listSnapshots(
          gpu.hostId,
          gpu.gpuIndex,
          querySince,
        );
        const stats = accumulateGpuStats(
          snapshots,
          start,
          end,
          idleThreshold,
        );
        const coverageMs = stats.dataMs;
        const usageMs = stats.usageMs;
        const capacityMs = windowDef.durationMs;
        const usageRatio = capacityMs > 0 ? usageMs / capacityMs : 0;
        const averageUtilizationPct =
          coverageMs > 0 ? stats.utilSum / coverageMs : 0;
        const averageMemoryPct =
          coverageMs > 0 ? (stats.memSum / coverageMs) * 100 : 0;
        windowStats[windowDef.id] = {
          usageMs,
          capacityMs,
          coverageMs,
          usageRatio,
          averageUtilizationPct,
          averageMemoryPct,
        };
      }
      return {
        hostId: gpu.hostId,
        gpuIndex: gpu.gpuIndex,
        gpuName: gpu.gpuName,
        windows: windowStats,
      };
    })
    .sort((a, b) => {
      if (a.hostId === b.hostId) {
        return a.gpuIndex - b.gpuIndex;
      }
      return a.hostId.localeCompare(b.hostId);
    });

  return NextResponse.json({
    windows,
    hosts: hostStats,
    gpus: gpuStats,
  });
}
