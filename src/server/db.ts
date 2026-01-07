import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let dbInstance: Database.Database | null = null;

const defaultDbPath = path.join(process.cwd(), 'data', 'gpu_watcher.db');

function ensureDirectory(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function initializeSchema(db: Database.Database) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS gpu_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id TEXT NOT NULL,
      gpu_index INTEGER NOT NULL,
      gpu_uuid TEXT,
      gpu_name TEXT NOT NULL,
      memory_used_mb INTEGER NOT NULL,
      memory_total_mb INTEGER NOT NULL,
      utilization_pct INTEGER NOT NULL,
      temperature_c INTEGER NOT NULL,
      processes_json TEXT NOT NULL,
      collected_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gpu_status (
      host_id TEXT NOT NULL,
      gpu_index INTEGER NOT NULL,
      gpu_uuid TEXT,
      gpu_name TEXT NOT NULL,
      memory_total_mb INTEGER NOT NULL DEFAULT 0,
      last_memory_used_mb INTEGER,
      last_utilization_pct INTEGER,
      last_temperature_c INTEGER,
      last_snapshot_id INTEGER,
      memory_history_json TEXT NOT NULL DEFAULT '[]',
      is_idle INTEGER NOT NULL DEFAULT 0,
      idle_since INTEGER,
      offline_since INTEGER,
      last_seen INTEGER,
      processes_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (host_id, gpu_index)
    );

    CREATE TABLE IF NOT EXISTS host_status (
      host_id TEXT PRIMARY KEY,
      label TEXT,
      is_online INTEGER NOT NULL DEFAULT 1,
      last_seen INTEGER,
      offline_since INTEGER,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gpu_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id TEXT NOT NULL,
      gpu_index INTEGER,
      type TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      notified INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_host_time
      ON gpu_snapshots (host_id, gpu_index, collected_at DESC);

    CREATE INDEX IF NOT EXISTS idx_events_host_time
      ON gpu_events (host_id, created_at DESC);
  `);
}

export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = process.env.GPU_WATCHER_DB_PATH
    ? path.resolve(process.env.GPU_WATCHER_DB_PATH)
    : defaultDbPath;

  ensureDirectory(dbPath);
  dbInstance = new Database(dbPath);
  initializeSchema(dbInstance);

  return dbInstance;
}
