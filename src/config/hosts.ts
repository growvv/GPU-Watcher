import fs from 'fs';
import path from 'path';
import { z } from 'zod';

import type { HostConfig } from '@/server/types';

const hostSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  connection: z.union([
    z.object({
      type: z.literal('local'),
    }),
    z.object({
      type: z.literal('ssh'),
      host: z.string().min(1),
      username: z.string().min(1),
      port: z.number().int().min(1).max(65535).optional(),
      privateKeyPath: z.string().optional(),
      readyTimeoutMs: z.number().int().positive().optional(),
    }),
  ]),
});

const hostsSchema = z.array(hostSchema);

const fallbackHosts: HostConfig[] = [];

const HOSTS_FILE =
  process.env.GPU_WATCHER_HOSTS_FILE ??
  path.join(process.cwd(), 'data', 'hosts.json');

function getHostsFileMtime() {
  if (!fs.existsSync(HOSTS_FILE)) {
    return 0;
  }
  try {
    return fs.statSync(HOSTS_FILE).mtimeMs;
  } catch {
    return 0;
  }
}

function ensureHostsDir() {
  const dir = path.dirname(HOSTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function tryParseHosts(raw: string | undefined) {
  if (!raw || raw.trim() === '') {
    return null;
  }
  try {
    return hostsSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[gpu-watcher] Failed to parse GPU_WATCHER_HOSTS', error);
    }
    return null;
  }
}

function readHostsFile() {
  if (!fs.existsSync(HOSTS_FILE)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(HOSTS_FILE, 'utf-8');
    return hostsSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.error('[gpu-watcher] Failed to read hosts file', error);
    return null;
  }
}

function writeHostsFile(hosts: HostConfig[]) {
  ensureHostsDir();
  fs.writeFileSync(HOSTS_FILE, JSON.stringify(hosts, null, 2), 'utf-8');
}

function loadInitialHosts(): HostConfig[] {
  const fileHosts = readHostsFile();
  if (fileHosts) {
    return fileHosts;
  }

  const envHosts = tryParseHosts(process.env.GPU_WATCHER_HOSTS);
  if (envHosts) {
    writeHostsFile(envHosts);
    return envHosts;
  }

  writeHostsFile(fallbackHosts);
  return fallbackHosts;
}

let currentHosts = loadInitialHosts();
let lastHostsFileMtime = getHostsFileMtime();

function maybeReloadHostsFromDisk() {
  if (!fs.existsSync(HOSTS_FILE)) {
    return;
  }
  let stats: fs.Stats;
  try {
    stats = fs.statSync(HOSTS_FILE);
  } catch {
    return;
  }
  if (stats.mtimeMs <= lastHostsFileMtime) {
    return;
  }
  try {
    const fileHosts = readHostsFile();
    if (fileHosts) {
      currentHosts = fileHosts;
      lastHostsFileMtime = stats.mtimeMs;
    }
  } catch (error) {
    console.error('[gpu-watcher] Failed to hot reload hosts file', error);
  }
}

export function getHosts(): HostConfig[] {
  maybeReloadHostsFromDisk();
  return currentHosts;
}

export function setHosts(nextHosts: HostConfig[]) {
  const parsed = hostsSchema.parse(nextHosts);
  currentHosts = parsed;
  writeHostsFile(parsed);
  lastHostsFileMtime = getHostsFileMtime();
}

export function upsertHost(host: HostConfig) {
  const existing = currentHosts.filter((item) => item.id !== host.id);
  setHosts([...existing, host]);
}

export function removeHost(id: string) {
  setHosts(currentHosts.filter((host) => host.id !== id));
}

export { hostSchema, hostsSchema };
