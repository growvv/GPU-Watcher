import type {
  HostConfig,
  ProcessInfo,
  SnapshotInput,
} from './types';
import { runCommand } from './commandRunner';

const GPU_QUERY =
  'nvidia-smi --query-gpu=index,uuid,name,memory.used,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader,nounits';
const PROCESS_QUERY =
  'nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader,nounits';

function parseCsvLine(line: string) {
  return line.split(',').map((part) => part.trim());
}

interface GpuRow {
  index: number;
  uuid?: string;
  name: string;
  memoryUsed: number;
  memoryTotal: number;
  utilization: number;
  temperature: number;
}

function parseGpuRows(raw: string): GpuRow[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [index, uuid, name, memoryUsed, memoryTotal, utilization, temp] =
        parseCsvLine(line);
      return {
        index: Number(index),
        uuid: uuid && uuid !== 'N/A' ? uuid : undefined,
        name,
        memoryUsed: Number(memoryUsed),
        memoryTotal: Number(memoryTotal),
        utilization: Number(utilization),
        temperature: Number(temp),
      };
    });
}

function parseProcessRows(raw: string) {
  const map = new Map<string, ProcessInfo[]>();
  const lines = raw.split('\n').map((line) => line.trim());

  for (const line of lines) {
    if (!line || line.startsWith('No running')) {
      continue;
    }
    const [uuid, pid, name, usedMemory] = parseCsvLine(line);
    const list = map.get(uuid) ?? [];
    list.push({
      pid: Number(pid),
      name,
      memoryUsedMb: Number(usedMemory),
    });
    map.set(uuid, list);
  }

  return map;
}

interface PsProcessRow {
  pid: number;
  ppid?: number;
  username?: string;
  command?: string;
  startedAt?: number;
}

function buildPidList(pids: number[]) {
  return Array.from(new Set(pids.filter((pid) => Number.isFinite(pid)))).join(
    ',',
  );
}

interface ProcessOwnershipInfo {
  hostUser?: string;
  containerId?: string;
  containerIdFull?: string;
  containerName?: string;
  ownerHint?: string;
  ownerSource?: 'host' | 'mount' | 'env' | 'unknown';
}

async function fetchPsRows(
  host: HostConfig,
  pids: number[],
  referenceTime: number,
): Promise<Map<number, PsProcessRow>> {
  const pidList = buildPidList(pids);
  if (!pidList) {
    return new Map();
  }

  const raw = await runCommand(
    host,
    `ps -o pid=,ppid=,user=,etimes=,args= --no-headers --sort=pid -p ${pidList} 2>/dev/null || true`,
  );

  const map = new Map<number, PsProcessRow>();
  if (!raw) {
    return map;
  }

  const lines = raw.split('\n').map((line) => line.trim());

  for (const line of lines) {
    if (!line) {
      continue;
    }
    const match = line.match(
      /^(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/,
    );
    if (!match) {
      continue;
    }
    const [, pidStr, ppidStr, username, etimesStr, commandPart] = match;
    const pid = Number(pidStr);
    const ppid = Number(ppidStr);
    const etimes = Number(etimesStr);
    const startedAt =
      Number.isFinite(etimes) && etimes >= 0
        ? Math.max(referenceTime - etimes * 1000, 0)
        : undefined;
    map.set(pid, {
      pid,
      ppid,
      username,
      command: commandPart.trim(),
      startedAt,
    });
  }

  return map;
}

async function enrichProcessDetails(
  host: HostConfig,
  processes: ProcessInfo[],
  referenceTime: number,
) {
  if (processes.length === 0) {
    return;
  }

  const primaryDetails = await fetchPsRows(
    host,
    processes.map((proc) => proc.pid),
    referenceTime,
  );

  const parentCandidates = Array.from(primaryDetails.values())
    .map((detail) => detail.ppid)
    .filter((pid): pid is number => typeof pid === 'number' && pid > 0);

  const missingParents = parentCandidates.filter(
    (pid, index, arr) =>
      arr.indexOf(pid) === index && !primaryDetails.has(pid),
  );

  if (missingParents.length > 0) {
    const parentDetails = await fetchPsRows(host, missingParents, referenceTime);
    for (const [pid, detail] of parentDetails.entries()) {
      primaryDetails.set(pid, detail);
    }
  }

  for (const process of processes) {
    const detail = primaryDetails.get(process.pid);
    if (!detail) {
      continue;
    }
    process.username = detail.username;
    process.command = detail.command;
    process.startedAt = detail.startedAt;
    if (detail.ppid) {
      const parentDetail = primaryDetails.get(detail.ppid);
      process.parent = {
        pid: detail.ppid,
        username: parentDetail?.username,
        command: parentDetail?.command,
        startedAt: parentDetail?.startedAt,
      };
    }
  }

  const ownershipMap = await detectProcessOwnership(host, processes);
  for (const process of processes) {
    const ownership = ownershipMap.get(process.pid);
    if (!ownership) {
      continue;
    }
    Object.assign(process, ownership);
  }
}

const DOCKER_ID_REGEX =
  /docker\/([0-9a-f]{64})|docker-([0-9a-f]{64})\.scope/;

function extractContainerId(cgroupContent: string) {
  const match = cgroupContent.match(DOCKER_ID_REGEX);
  if (!match) {
    return undefined;
  }
  const id = match[1] ?? match[2];
  if (!id) {
    return undefined;
  }
  return id;
}

function parseMountUserHint(mounts: unknown) {
  if (!Array.isArray(mounts)) {
    return undefined;
  }
  for (const mount of mounts) {
    if (
      mount &&
      typeof mount === 'object' &&
      'Source' in mount &&
      typeof mount.Source === 'string' &&
      mount.Source.includes('/home/')
    ) {
      const parts = mount.Source.split('/');
      if (parts.length >= 3 && parts[1] === 'home') {
        return parts[2];
      }
    }
  }
  return undefined;
}

function parseEnvUserHint(envList: unknown) {
  if (!Array.isArray(envList)) {
    return undefined;
  }
  for (const entry of envList) {
    if (typeof entry === 'string' && entry.startsWith('USER=')) {
      const value = entry.split('=')[1];
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

async function resolveProcessOwnership(
  host: HostConfig,
  pid: number,
): Promise<ProcessOwnershipInfo> {
  const ownership: ProcessOwnershipInfo = {};
  try {
    const hostUser = await runCommand(
      host,
      `ps -o user= -p ${pid} 2>/dev/null || true`,
    );
    ownership.hostUser = hostUser || undefined;
  } catch {
    // ignore
  }

  let cgroupContent = '';
  try {
    cgroupContent = await runCommand(
      host,
      `cat /proc/${pid}/cgroup 2>/dev/null || true`,
    );
  } catch {
    // ignore
  }

  const containerIdFull = cgroupContent
    ? extractContainerId(cgroupContent)
    : undefined;

  if (!containerIdFull) {
    ownership.ownerHint = ownership.hostUser;
    ownership.ownerSource = ownership.hostUser ? 'host' : 'unknown';
    return ownership;
  }

  ownership.containerIdFull = containerIdFull;
  ownership.containerId = containerIdFull.slice(0, 12);

  try {
    const inspectRaw = await runCommand(
      host,
      `docker inspect --format '{{json .}}' ${containerIdFull} 2>/dev/null || true`,
    );
    if (inspectRaw) {
      const inspectData = JSON.parse(inspectRaw) as {
        Name?: string;
        Mounts?: Array<{ Source?: string }>;
        Config?: { Env?: string[] };
      };
      if (inspectData.Name) {
        ownership.containerName = inspectData.Name.replace(/^\//, '');
      }
      const mountHint = parseMountUserHint(inspectData.Mounts);
      if (mountHint) {
        ownership.ownerHint = mountHint;
        ownership.ownerSource = 'mount';
        return ownership;
      }
      const envHint = parseEnvUserHint(inspectData.Config?.Env);
      if (envHint) {
        ownership.ownerHint = envHint;
        ownership.ownerSource = 'env';
        return ownership;
      }
    }
  } catch {
    // ignore inspect failures
  }

  ownership.ownerHint = ownership.hostUser ?? 'Unknown';
  ownership.ownerSource = ownership.hostUser ? 'host' : 'unknown';
  return ownership;
}

async function detectProcessOwnership(
  host: HostConfig,
  processes: ProcessInfo[],
) {
  const map = new Map<number, ProcessOwnershipInfo>();
  for (const process of processes) {
    try {
      const ownership = await resolveProcessOwnership(host, process.pid);
      map.set(process.pid, ownership);
    } catch (error) {
      console.error(
        `[gpu-watcher] Failed to resolve ownership for pid ${process.pid} on ${host.id}`,
        error,
      );
    }
  }
  return map;
}

export async function collectSnapshotsForHost(
  host: HostConfig,
): Promise<SnapshotInput[]> {
  const [gpuRaw, processRaw] = await Promise.all([
    runCommand(host, GPU_QUERY),
    runCommand(host, PROCESS_QUERY).catch((error: Error) => {
      if (
        error.message.includes('No running') ||
        error.message.includes('processes found')
      ) {
        return '';
      }
      throw error;
    }),
  ]);

  const gpuRows = parseGpuRows(gpuRaw);
  const processMap = parseProcessRows(processRaw);
  const collectedAt = Date.now();

  const allProcesses = Array.from(processMap.values()).flat();
  await enrichProcessDetails(host, allProcesses, collectedAt);

  return gpuRows.map<SnapshotInput>((row) => ({
    hostId: host.id,
    gpuIndex: row.index,
    gpuUuid: row.uuid,
    gpuName: row.name,
    memoryUsedMb: row.memoryUsed,
    memoryTotalMb: row.memoryTotal,
    utilizationPct: row.utilization,
    temperatureC: row.temperature,
    processes: row.uuid ? processMap.get(row.uuid) ?? [] : [],
    collectedAt,
  }));
}
