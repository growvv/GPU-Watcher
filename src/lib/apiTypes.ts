export interface HostStatus {
  hostId: string;
  label?: string;
  isOnline: boolean;
  lastSeen?: number;
  offlineSince?: number;
  lastError?: string;
  updatedAt: number;
}

export interface ProcessParentInfo {
  pid: number;
  username?: string;
  command?: string;
  startedAt?: number;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  memoryUsedMb: number;
  username?: string;
  command?: string;
  startedAt?: number;
  parent?: ProcessParentInfo;
  hostUser?: string;
  containerId?: string;
  containerName?: string;
  containerIdFull?: string;
  ownerHint?: string;
  ownerSource?: 'host' | 'mount' | 'env' | 'unknown';
}

export interface GpuStatus {
  hostId: string;
  gpuIndex: number;
  gpuUuid?: string;
  gpuName: string;
  memoryTotalMb?: number;
  lastMemoryUsedMb?: number;
  lastUtilizationPct?: number;
  lastTemperatureC?: number;
  lastSnapshotId?: number;
  memoryHistory: number[];
  isIdle: boolean;
  idleSince?: number;
  offlineSince?: number;
  lastSeen?: number;
  processes: ProcessInfo[];
}

export type GpuEventType =
  | 'process_online'
  | 'process_offline'
  | 'gpu_idle_start'
  | 'gpu_idle_end'
  | 'host_offline'
  | 'host_online';

export interface GpuEvent {
  id: number;
  hostId: string;
  gpuIndex: number | null;
  type: GpuEventType;
  details: Record<string, unknown>;
  createdAt: number;
  notified: boolean;
}

export interface StatusResponse {
  hosts: HostStatus[];
  gpus: GpuStatus[];
  config: {
    telegramConfigured: boolean;
    pollIntervalMs: number;
    idleWindow: number;
    idleThreshold: number;
    processDisplayMinMemoryMb: number;
    chartWindowHours: number;
    hostDefinitions: Array<{ id: string; label?: string }>;
  };
}

export interface EventsResponse {
  events: GpuEvent[];
}

export interface SnapshotPoint {
  timestamp: number;
  utilizationPct: number;
  memoryPct: number;
  temperatureC: number;
}

export interface SnapshotResponse {
  points: SnapshotPoint[];
}

export interface StatsWindowDef {
  id: string;
  label: string;
  durationMs: number;
}

export interface UsageWindowStats {
  usageMs: number;
  capacityMs: number;
  coverageMs: number;
  usageRatio: number;
  averageUtilizationPct: number;
  averageMemoryPct: number;
}

export interface HostUsageStats {
  hostId: string;
  label?: string;
  gpuCount: number;
  windows: Record<string, UsageWindowStats>;
}

export interface GpuUsageStats {
  hostId: string;
  gpuIndex: number;
  gpuName?: string;
  windows: Record<string, UsageWindowStats>;
}

export interface StatsResponse {
  windows: StatsWindowDef[];
  hosts: HostUsageStats[];
  gpus: GpuUsageStats[];
}
