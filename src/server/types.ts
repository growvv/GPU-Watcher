export type HostConnectionConfig =
  | {
      type: 'local';
    }
  | {
      type: 'ssh';
      host: string;
      username: string;
      port?: number;
      privateKeyPath?: string;
      readyTimeoutMs?: number;
    };

export interface HostConfig {
  id: string;
  label?: string;
  connection: HostConnectionConfig;
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
  containerIdFull?: string;
  containerName?: string;
  ownerHint?: string;
  ownerSource?: 'host' | 'mount' | 'env' | 'unknown';
}

export interface SnapshotInput {
  hostId: string;
  gpuIndex: number;
  gpuUuid?: string;
  gpuName: string;
  memoryUsedMb: number;
  memoryTotalMb: number;
  utilizationPct: number;
  temperatureC: number;
  processes: ProcessInfo[];
  collectedAt: number;
}

export type GpuEventType =
  | 'process_online'
  | 'process_offline'
  | 'gpu_idle_start'
  | 'gpu_idle_end'
  | 'host_offline'
  | 'host_online';

export interface GpuEventRecord {
  id: number;
  hostId: string;
  gpuIndex: number | null;
  type: GpuEventType;
  details: Record<string, unknown>;
  createdAt: number;
  notified: boolean;
}

export interface HostStatusRecord {
  hostId: string;
  label?: string;
  isOnline: boolean;
  lastSeen?: number;
  offlineSince?: number;
  lastError?: string;
  updatedAt: number;
}

export interface GpuStatusRecord {
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
