import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const runtimeSchema = z.object({
  pollIntervalMs: z.number().int().positive().default(60_000),
  idleWindow: z.number().int().min(1).default(5),
  idleThreshold: z.number().min(0).max(1).default(0.1),
  chartWindowHours: z.number().int().min(1).max(168).default(24),
  pinnedHosts: z.array(z.string()).default([]),
  hiddenHosts: z.array(z.string()).default([]),
  telegram: z
    .object({
      botToken: z.string().optional(),
      chatId: z.string().optional(),
      disableNotifications: z.boolean().optional(),
    })
    .default({}),
});

export type RuntimeConfig = z.infer<typeof runtimeSchema>;

const DEFAULT_RUNTIME: RuntimeConfig = {
  pollIntervalMs: 60_000,
  idleWindow: 5,
  idleThreshold: 0.1,
  chartWindowHours: 24,
  pinnedHosts: [],
  hiddenHosts: [],
  telegram: {},
};

const RUNTIME_FILE =
  process.env.GPU_WATCHER_RUNTIME_FILE ??
  path.join(process.cwd(), 'config', 'settings.json');

function ensureRuntimeDir() {
  const dir = path.dirname(RUNTIME_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getRuntimeFileMtime() {
  if (!fs.existsSync(RUNTIME_FILE)) {
    return 0;
  }
  try {
    return fs.statSync(RUNTIME_FILE).mtimeMs;
  } catch {
    return 0;
  }
}

function readRuntimeFile() {
  if (!fs.existsSync(RUNTIME_FILE)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(RUNTIME_FILE, 'utf-8');
    return runtimeSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.error('[gpu-watcher] Failed to parse runtime settings', error);
    return null;
  }
}

function normalizeRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  return {
    ...config,
    pinnedHosts: Array.from(new Set(config.pinnedHosts ?? [])),
    hiddenHosts: Array.from(new Set(config.hiddenHosts ?? [])),
    telegram: config.telegram ?? {},
  };
}

function writeRuntimeFile(config: RuntimeConfig) {
  ensureRuntimeDir();
  fs.writeFileSync(
    RUNTIME_FILE,
    JSON.stringify(normalizeRuntimeConfig(config), null, 2),
    'utf-8',
  );
}

function loadRuntimeConfig(): RuntimeConfig {
  const fileConfig = readRuntimeFile();
  if (!fileConfig) {
    writeRuntimeFile(DEFAULT_RUNTIME);
    return DEFAULT_RUNTIME;
  }
  const merged = normalizeRuntimeConfig(
    runtimeSchema.parse({
      ...DEFAULT_RUNTIME,
      ...fileConfig,
      telegram: {
        ...fileConfig.telegram,
      },
    }),
  );
  writeRuntimeFile(merged);
  return merged;
}

let currentRuntimeConfig = loadRuntimeConfig();
let lastRuntimeFileMtime = getRuntimeFileMtime();

function maybeReloadRuntimeFromDisk() {
  if (!fs.existsSync(RUNTIME_FILE)) {
    return;
  }
  let stats: fs.Stats;
  try {
    stats = fs.statSync(RUNTIME_FILE);
  } catch {
    return;
  }
  if (stats.mtimeMs <= lastRuntimeFileMtime) {
    return;
  }
  const fileConfig = readRuntimeFile();
  if (fileConfig) {
    currentRuntimeConfig = normalizeRuntimeConfig(fileConfig);
    lastRuntimeFileMtime = stats.mtimeMs;
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  maybeReloadRuntimeFromDisk();
  return currentRuntimeConfig;
}

export function updateRuntimeConfig(
  patch: Partial<RuntimeConfig>,
): RuntimeConfig {
  const pinnedHosts = patch.pinnedHosts
    ? Array.from(new Set(patch.pinnedHosts))
    : currentRuntimeConfig.pinnedHosts;
  const hiddenHosts = patch.hiddenHosts
    ? Array.from(new Set(patch.hiddenHosts))
    : currentRuntimeConfig.hiddenHosts;

  currentRuntimeConfig = {
    ...currentRuntimeConfig,
    ...patch,
    pinnedHosts,
    hiddenHosts,
    telegram: {
      ...currentRuntimeConfig.telegram,
      ...patch.telegram,
    },
  };
  currentRuntimeConfig = normalizeRuntimeConfig(currentRuntimeConfig);
  writeRuntimeFile(currentRuntimeConfig);
  lastRuntimeFileMtime = getRuntimeFileMtime();
  return currentRuntimeConfig;
}
