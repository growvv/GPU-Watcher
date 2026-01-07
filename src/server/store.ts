import { getDb } from './db';
import {
  GpuEventRecord,
  GpuEventType,
  GpuStatusRecord,
  HostStatusRecord,
  ProcessInfo,
  SnapshotInput,
} from './types';

type InsertSnapshotRow = SnapshotInput & {
  snapshotId: number;
};

interface SaveGpuStatusPayload {
  hostId: string;
  gpuIndex: number;
  gpuUuid?: string;
  gpuName: string;
  memoryTotalMb: number;
  lastMemoryUsedMb: number;
  lastUtilizationPct: number;
  lastTemperatureC: number;
  lastSnapshotId?: number;
  memoryHistory: number[];
  isIdle: boolean;
  idleSince?: number;
  offlineSince?: number;
  lastSeen?: number;
  processes: ProcessInfo[];
}

interface SaveHostStatusPayload {
  hostId: string;
  label?: string;
  isOnline: boolean;
  lastSeen?: number;
  offlineSince?: number;
  lastError?: string;
}

interface InsertEventPayload {
  hostId: string;
  gpuIndex?: number | null;
  type: GpuEventType;
  details: Record<string, unknown>;
  createdAt?: number;
  notified?: boolean;
}

declare global {
  var __gpuWatcherStore: GpuWatcherStore | undefined;
}

class GpuWatcherStore {
  private db = getDb();

  recordSnapshot(snapshot: SnapshotInput): InsertSnapshotRow {
    const stmt = this.db.prepare(
      `
      INSERT INTO gpu_snapshots (
        host_id,
        gpu_index,
        gpu_uuid,
        gpu_name,
        memory_used_mb,
        memory_total_mb,
        utilization_pct,
        temperature_c,
        processes_json,
        collected_at,
        created_at
      )
      VALUES (
        @hostId,
        @gpuIndex,
        @gpuUuid,
        @gpuName,
        @memoryUsedMb,
        @memoryTotalMb,
        @utilizationPct,
        @temperatureC,
        @processesJson,
        @collectedAt,
        @createdAt
      )
    `,
    );

    const createdAt = Date.now();
    const result = stmt.run({
      hostId: snapshot.hostId,
      gpuIndex: snapshot.gpuIndex,
      gpuUuid: snapshot.gpuUuid ?? null,
      gpuName: snapshot.gpuName,
      memoryUsedMb: snapshot.memoryUsedMb,
      memoryTotalMb: snapshot.memoryTotalMb,
      utilizationPct: snapshot.utilizationPct,
      temperatureC: snapshot.temperatureC,
      processesJson: JSON.stringify(snapshot.processes),
      collectedAt: snapshot.collectedAt,
      createdAt,
    });

    return {
      ...snapshot,
      snapshotId: Number(result.lastInsertRowid),
    };
  }

  getGpuStatus(hostId: string, gpuIndex: number): GpuStatusRecord | undefined {
    const stmt = this.db.prepare(
      `
      SELECT
        host_id as hostId,
        gpu_index as gpuIndex,
        gpu_uuid as gpuUuid,
        gpu_name as gpuName,
        memory_total_mb as memoryTotalMb,
        last_memory_used_mb as lastMemoryUsedMb,
        last_utilization_pct as lastUtilizationPct,
        last_temperature_c as lastTemperatureC,
        last_snapshot_id as lastSnapshotId,
        memory_history_json as memoryHistoryJson,
        is_idle as isIdle,
        idle_since as idleSince,
        offline_since as offlineSince,
        last_seen as lastSeen,
        processes_json as processesJson
      FROM gpu_status
      WHERE host_id = ? AND gpu_index = ?
    `,
    );

    const row = stmt.get(hostId, gpuIndex) as
      | (Omit<GpuStatusRecord, 'memoryHistory' | 'processes'> & {
          memoryHistoryJson: string;
          processesJson: string;
        })
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      hostId: row.hostId,
      gpuIndex: row.gpuIndex,
      gpuUuid: row.gpuUuid ?? undefined,
      gpuName: row.gpuName,
      memoryTotalMb: row.memoryTotalMb ?? undefined,
      lastMemoryUsedMb: row.lastMemoryUsedMb ?? undefined,
      lastUtilizationPct: row.lastUtilizationPct ?? undefined,
      lastTemperatureC: row.lastTemperatureC ?? undefined,
      lastSnapshotId: row.lastSnapshotId ?? undefined,
      memoryHistory: JSON.parse(row.memoryHistoryJson ?? '[]'),
      isIdle: Boolean(row.isIdle),
      idleSince: row.idleSince ?? undefined,
      offlineSince: row.offlineSince ?? undefined,
      lastSeen: row.lastSeen ?? undefined,
      processes: JSON.parse(row.processesJson ?? '[]'),
    };
  }

  saveGpuStatus(payload: SaveGpuStatusPayload) {
    const stmt = this.db.prepare(
      `
      INSERT INTO gpu_status (
        host_id,
        gpu_index,
        gpu_uuid,
        gpu_name,
        memory_total_mb,
        last_memory_used_mb,
        last_utilization_pct,
        last_temperature_c,
        last_snapshot_id,
        memory_history_json,
        is_idle,
        idle_since,
        offline_since,
        last_seen,
        processes_json
      )
      VALUES (
        @hostId,
        @gpuIndex,
        @gpuUuid,
        @gpuName,
        @memoryTotalMb,
        @lastMemoryUsedMb,
        @lastUtilizationPct,
        @lastTemperatureC,
        @lastSnapshotId,
        @memoryHistoryJson,
        @isIdle,
        @idleSince,
        @offlineSince,
        @lastSeen,
        @processesJson
      )
      ON CONFLICT(host_id, gpu_index) DO UPDATE SET
        gpu_uuid = excluded.gpu_uuid,
        gpu_name = excluded.gpu_name,
        memory_total_mb = excluded.memory_total_mb,
        last_memory_used_mb = excluded.last_memory_used_mb,
        last_utilization_pct = excluded.last_utilization_pct,
        last_temperature_c = excluded.last_temperature_c,
        last_snapshot_id = excluded.last_snapshot_id,
        memory_history_json = excluded.memory_history_json,
        is_idle = excluded.is_idle,
        idle_since = excluded.idle_since,
        offline_since = excluded.offline_since,
        last_seen = excluded.last_seen,
        processes_json = excluded.processes_json
    `,
    );

    stmt.run({
      hostId: payload.hostId,
      gpuIndex: payload.gpuIndex,
      gpuUuid: payload.gpuUuid ?? null,
      gpuName: payload.gpuName,
      memoryTotalMb: payload.memoryTotalMb,
      lastMemoryUsedMb: payload.lastMemoryUsedMb,
      lastUtilizationPct: payload.lastUtilizationPct,
      lastTemperatureC: payload.lastTemperatureC,
      lastSnapshotId: payload.lastSnapshotId ?? null,
      memoryHistoryJson: JSON.stringify(payload.memoryHistory ?? []),
      isIdle: payload.isIdle ? 1 : 0,
      idleSince: payload.idleSince ?? null,
      offlineSince: payload.offlineSince ?? null,
      lastSeen: payload.lastSeen ?? null,
      processesJson: JSON.stringify(payload.processes ?? []),
    });
  }

  saveHostStatus(payload: SaveHostStatusPayload) {
    const stmt = this.db.prepare(
      `
      INSERT INTO host_status (
        host_id,
        label,
        is_online,
        last_seen,
        offline_since,
        last_error,
        updated_at
      )
      VALUES (
        @hostId,
        @label,
        @isOnline,
        @lastSeen,
        @offlineSince,
        @lastError,
        @updatedAt
      )
      ON CONFLICT(host_id) DO UPDATE SET
        label = excluded.label,
        is_online = excluded.is_online,
        last_seen = excluded.last_seen,
        offline_since = excluded.offline_since,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `,
    );

    const now = Date.now();
    stmt.run({
      hostId: payload.hostId,
      label: payload.label ?? null,
      isOnline: payload.isOnline ? 1 : 0,
      lastSeen: payload.lastSeen ?? null,
      offlineSince: payload.offlineSince ?? null,
      lastError: payload.lastError ?? null,
      updatedAt: now,
    });
  }

  getHostStatus(hostId: string): HostStatusRecord | undefined {
    const stmt = this.db.prepare(
      `
      SELECT
        host_id as hostId,
        label,
        is_online as isOnline,
        last_seen as lastSeen,
        offline_since as offlineSince,
        last_error as lastError,
        updated_at as updatedAt
      FROM host_status
      WHERE host_id = ?
    `,
    );

    const row = stmt.get(hostId) as
      | {
          hostId: string;
          label: string | null;
          isOnline: number;
          lastSeen: number | null;
          offlineSince: number | null;
          lastError: string | null;
          updatedAt: number;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      hostId: row.hostId,
      label: row.label ?? undefined,
      isOnline: Boolean(row.isOnline),
      lastSeen: row.lastSeen ?? undefined,
      offlineSince: row.offlineSince ?? undefined,
      lastError: row.lastError ?? undefined,
      updatedAt: row.updatedAt,
    };
  }

  insertEvent(payload: InsertEventPayload): GpuEventRecord {
    const stmt = this.db.prepare(
      `
      INSERT INTO gpu_events (
        host_id,
        gpu_index,
        type,
        details_json,
        created_at,
        notified
      )
      VALUES (
        @hostId,
        @gpuIndex,
        @type,
        @detailsJson,
        @createdAt,
        @notified
      )
    `,
    );

    const createdAt = payload.createdAt ?? Date.now();
    const result = stmt.run({
      hostId: payload.hostId,
      gpuIndex: payload.gpuIndex ?? null,
      type: payload.type,
      detailsJson: JSON.stringify(payload.details ?? {}),
      createdAt,
      notified: payload.notified ? 1 : 0,
    });

    return {
      id: Number(result.lastInsertRowid),
      hostId: payload.hostId,
      gpuIndex: payload.gpuIndex ?? null,
      type: payload.type,
      details: payload.details,
      createdAt,
      notified: Boolean(payload.notified),
    };
  }

  markEventAsNotified(eventId: number) {
    const stmt = this.db.prepare(
      `UPDATE gpu_events SET notified = 1 WHERE id = ?`,
    );
    stmt.run(eventId);
  }

  markHostOffline(hostId: string, since: number) {
    const stmt = this.db.prepare(
      `
      UPDATE gpu_status
      SET offline_since = COALESCE(offline_since, @since)
      WHERE host_id = @hostId
    `,
    );
    stmt.run({ hostId, since });
  }

  clearHostOffline(hostId: string) {
    const stmt = this.db.prepare(
      `
      UPDATE gpu_status
      SET offline_since = NULL
      WHERE host_id = ?
    `,
    );
    stmt.run(hostId);
  }

  listGpuStatuses(): GpuStatusRecord[] {
    const stmt = this.db.prepare(
      `
      SELECT
        host_id as hostId,
        gpu_index as gpuIndex,
        gpu_uuid as gpuUuid,
        gpu_name as gpuName,
        memory_total_mb as memoryTotalMb,
        last_memory_used_mb as lastMemoryUsedMb,
        last_utilization_pct as lastUtilizationPct,
        last_temperature_c as lastTemperatureC,
        last_snapshot_id as lastSnapshotId,
        memory_history_json as memoryHistoryJson,
        is_idle as isIdle,
        idle_since as idleSince,
        offline_since as offlineSince,
        last_seen as lastSeen,
        processes_json as processesJson
      FROM gpu_status
      ORDER BY host_id ASC, gpu_index ASC
    `,
    );

    const rows = stmt.all() as Array<
      Omit<GpuStatusRecord, 'memoryHistory' | 'processes'> & {
        memoryHistoryJson: string;
        processesJson: string;
      }
    >;

    return rows.map((row) => ({
      hostId: row.hostId,
      gpuIndex: row.gpuIndex,
      gpuUuid: row.gpuUuid ?? undefined,
      gpuName: row.gpuName,
      memoryTotalMb: row.memoryTotalMb ?? undefined,
      lastMemoryUsedMb: row.lastMemoryUsedMb ?? undefined,
      lastUtilizationPct: row.lastUtilizationPct ?? undefined,
      lastTemperatureC: row.lastTemperatureC ?? undefined,
      lastSnapshotId: row.lastSnapshotId ?? undefined,
      memoryHistory: JSON.parse(row.memoryHistoryJson ?? '[]'),
      isIdle: Boolean(row.isIdle),
      idleSince: row.idleSince ?? undefined,
      offlineSince: row.offlineSince ?? undefined,
      lastSeen: row.lastSeen ?? undefined,
      processes: JSON.parse(row.processesJson ?? '[]'),
    }));
  }

  listHostStatuses(): HostStatusRecord[] {
    const stmt = this.db.prepare(
      `
      SELECT
        host_id as hostId,
        label,
        is_online as isOnline,
        last_seen as lastSeen,
        offline_since as offlineSince,
        last_error as lastError,
        updated_at as updatedAt
      FROM host_status
      ORDER BY host_id ASC
    `,
    );

    const rows = stmt.all() as Array<{
      hostId: string;
      label: string | null;
      isOnline: number;
      lastSeen: number | null;
      offlineSince: number | null;
      lastError: string | null;
      updatedAt: number;
    }>;

    return rows.map((row) => ({
      hostId: row.hostId,
      label: row.label ?? undefined,
      isOnline: Boolean(row.isOnline),
      lastSeen: row.lastSeen ?? undefined,
      offlineSince: row.offlineSince ?? undefined,
      lastError: row.lastError ?? undefined,
      updatedAt: row.updatedAt,
    }));
  }

  listEvents(limit = 50, offset = 0): GpuEventRecord[] {
    const stmt = this.db.prepare(
      `
      SELECT
        id,
        host_id as hostId,
        gpu_index as gpuIndex,
        type,
        details_json as detailsJson,
        created_at as createdAt,
        notified
      FROM gpu_events
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    );

    const rows = stmt.all(limit, offset) as Array<{
      id: number;
      hostId: string;
      gpuIndex: number | null;
      type: GpuEventType;
      detailsJson: string;
      createdAt: number;
      notified: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      hostId: row.hostId,
      gpuIndex: row.gpuIndex,
      type: row.type,
      details: JSON.parse(row.detailsJson ?? '{}'),
      createdAt: row.createdAt,
      notified: Boolean(row.notified),
    }));
  }

  listSnapshots(hostId: string, gpuIndex: number, since: number) {
    const stmt = this.db.prepare(
      `
      SELECT
        id,
        collected_at as collectedAt,
        memory_used_mb as memoryUsedMb,
        memory_total_mb as memoryTotalMb,
        utilization_pct as utilizationPct,
        temperature_c as temperatureC
      FROM gpu_snapshots
      WHERE host_id = ? AND gpu_index = ? AND collected_at >= ?
      ORDER BY collected_at ASC
    `,
    );

    const rows = stmt.all(hostId, gpuIndex, since) as Array<{
      id: number;
      collectedAt: number;
      memoryUsedMb: number;
      memoryTotalMb: number;
      utilizationPct: number;
      temperatureC: number;
    }>;

    return rows;
  }

  deleteSnapshotsBefore(timestamp: number) {
    const stmt = this.db.prepare(
      `DELETE FROM gpu_snapshots WHERE collected_at < ?`,
    );
    stmt.run(timestamp);
  }
}

export function getStore() {
  if (!globalThis.__gpuWatcherStore) {
    globalThis.__gpuWatcherStore = new GpuWatcherStore();
  }
  return globalThis.__gpuWatcherStore;
}
