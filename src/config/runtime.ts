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

const RUNTIME_FILE =
  process.env.GPU_WATCHER_RUNTIME_FILE ??
  path.join(process.cwd(), 'data', 'settings.json');

function ensureRuntimeDir() {
  const dir = path.dirname(RUNTIME_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function buildEnvConfig(): RuntimeConfig {
  return {
    pollIntervalMs: Number(
      process.env.GPU_WATCHER_POLL_INTERVAL_MS ?? 60_000,
    ),
    idleWindow: Number(process.env.GPU_IDLE_WINDOW ?? 5),
    idleThreshold: Number(process.env.GPU_IDLE_THRESHOLD ?? 0.1),
    chartWindowHours: Number(process.env.GPU_CHART_WINDOW_HOURS ?? 24),
    pinnedHosts: [],
    hiddenHosts: [],
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? undefined,
      chatId: process.env.TELEGRAM_CHAT_ID ?? undefined,
      disableNotifications:
        process.env.TELEGRAM_DISABLE_NOTIFICATIONS === 'true',
    },
  };
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

function writeRuntimeFile(config: RuntimeConfig) {
  ensureRuntimeDir();
  fs.writeFileSync(RUNTIME_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function loadRuntimeConfig(): RuntimeConfig {
  const envConfig = runtimeSchema.parse(buildEnvConfig());
  const fileConfig = readRuntimeFile();
  if (!fileConfig) {
    writeRuntimeFile(envConfig);
    return envConfig;
  }
  const merged: RuntimeConfig = {
    ...envConfig,
    ...fileConfig,
    telegram: {
      ...envConfig.telegram,
      ...fileConfig.telegram,
    },
    pinnedHosts: Array.from(new Set(fileConfig.pinnedHosts ?? [])),
    hiddenHosts: Array.from(new Set(fileConfig.hiddenHosts ?? [])),
  };
  writeRuntimeFile(merged);
  return merged;
}

let currentRuntimeConfig = loadRuntimeConfig();

export function getRuntimeConfig(): RuntimeConfig {
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
  writeRuntimeFile(currentRuntimeConfig);
  return currentRuntimeConfig;
}
