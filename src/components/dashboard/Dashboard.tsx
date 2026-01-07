'use client';

import { cloneElement, useEffect, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type {
  EventsResponse,
  GpuEvent,
  HostStatus,
  ProcessInfo,
  SnapshotResponse,
  StatusResponse,
  StatsResponse,
  GpuStatus,
  HostUsageStats,
  GpuUsageStats,
} from '@/lib/apiTypes';
import { formatDateTime, formatDuration } from '@/lib/format';

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }
    return res.json();
  });

interface DashboardProps {
  initialStatus: StatusResponse;
  initialEvents: EventsResponse;
}

interface Selection {
  hostId: string;
  gpuIndex: number;
}

type HostCard = HostStatus & { pending?: boolean; hidden?: boolean };
type ViewKey = 'home' | 'gpus' | 'hosts' | 'stats' | 'timeline' | 'settings';

interface RuntimeSettings {
  pollIntervalMs: number;
  idleWindow: number;
  idleThreshold: number;
  chartWindowHours: number;
  pinnedHosts: string[];
  hiddenHosts: string[];
  telegram: {
    chatId: string | null;
    hasToken: boolean;
    disableNotifications: boolean;
  };
}

interface StatusMessage {
  type: 'success' | 'error';
  text: string;
}

const navItems: Array<{ id: ViewKey; label: string; description: string }> = [
  { id: 'home', label: '欢迎', description: '品牌动画与项目说明' },
  { id: 'hosts', label: '主机', description: '主机在线状态' },
  { id: 'gpus', label: 'GPU 监控', description: '显卡列表 + 曲线' },
  { id: 'stats', label: '使用统计', description: '按主机 / GPU 查看占用' },
  { id: 'timeline', label: '事件时间线', description: 'Host / Process 分轨迹' },
  { id: 'settings', label: '设置', description: '快速添加主机与参数调优' },
];

const gpuArtworkPresets = [
  {
    match: /a800/i,
    accent: '#f97316',
    label: 'Hopper 数据中心',
    icon: (
      <svg viewBox="0 0 32 32" className="h-full w-full">
        <rect width="32" height="32" rx="6" fill="#f97316" />
      </svg>
    ),
  },
  {
    match: /4090/i,
    accent: '#10b981',
    label: 'Ada GeForce 4090',
    icon: (
      <svg viewBox="0 0 32 32" className="h-full w-full">
        <rect width="32" height="32" rx="6" fill="#10b981" />
      </svg>
    ),
  },
  {
    match: /5090/i,
    accent: '#0ea5e9',
    label: 'Blackwell 5090',
    icon: (
      <svg viewBox="0 0 32 32" className="h-full w-full">
        <rect width="32" height="32" rx="6" fill="#0ea5e9" />
      </svg>
    ),
  },
];

function getGpuArtwork(gpuName: string) {
  const preset =
    gpuArtworkPresets.find((preset) => preset.match.test(gpuName)) ?? {
      gradient: 'from-slate-100 via-slate-50 to-white',
      accent: '#6366f1',
      label: gpuName,
      icon: (
        <svg viewBox="0 0 32 32" className="h-full w-full">
          <rect width="32" height="32" rx="6" fill="#6366f1" />
        </svg>
      ),
    };
  return preset;
}

const metricConfig = {
  utilization: {
    label: 'GPU 利用率',
    color: '#38bdf8',
    dataKey: 'utilization',
  },
  memory: {
    label: '显存占比',
    color: '#22c55e',
    dataKey: 'memory',
  },
  temperature: {
    label: '温度',
    color: '#fb923c',
    dataKey: 'temperature',
  },
} as const;

const statusBadgeStyles = {
  offline: {
    default: 'bg-rose-50 text-rose-700',
    selected: 'bg-rose-500/30 text-rose-100',
  },
  idle: {
    default: 'bg-amber-50 text-amber-700',
    selected: 'bg-amber-400/25 text-amber-100',
  },
  busy: {
    default: 'bg-emerald-50 text-emerald-700',
    selected: 'bg-emerald-500/25 text-emerald-100',
  },
} as const;
function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function formatHours(ms: number) {
  if (!ms || ms <= 0) {
    return '0 h';
  }
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

function formatPercentValue(value: number) {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  return `${value.toFixed(1)}%`;
}

function getCoverageTone(ratio: number) {
  if (!Number.isFinite(ratio)) {
    return 'text-slate-400';
  }
  if (ratio >= 0.7) {
    return 'text-emerald-600';
  }
  if (ratio >= 0.4) {
    return 'text-amber-600';
  }
  return 'text-rose-600';
}

export function Dashboard({
  initialStatus,
  initialEvents,
}: DashboardProps) {
  const { mutate } = useSWRConfig();
  const swrPollInterval = initialStatus.config.pollIntervalMs ?? 60_000;

  const [activeView, setActiveView] = useState<ViewKey>('home');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const isDark = theme === 'dark';
  const themed = (light: string, dark: string) => (isDark ? dark : light);
  const primaryCardClass = themed(
    'border-transparent bg-gradient-to-br from-white via-[#f0f6ff] to-[#fff2fb] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]',
    'border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-[#0b1120] text-slate-100',
  );
  const softCardClass = themed(
    'border-transparent bg-gradient-to-br from-[#fefefe] via-[#f0f4ff] to-[#fff7f1] text-slate-500 shadow-[0_8px_20px_rgba(15,23,42,0.08)]',
    'border-slate-800 bg-gradient-to-br from-slate-900 via-[#111827] to-[#050b16] text-slate-300',
  );
  const inputClass = classNames(
    'rounded-xl border px-4 py-2 text-sm',
    themed(
      'border-slate-200 bg-white/90 text-slate-900 shadow-[0_4px_12px_rgba(15,23,42,0.06)] focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100',
      'border-slate-700 bg-slate-900 text-slate-100 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-700/40',
    ),
  );
  const [chartMode, setChartMode] = useState<
    'all' | 'utilization' | 'memory' | 'temperature'
  >('all');
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'host' | 'process'>(
    'all',
  );
  const [timelineQuery, setTimelineQuery] = useState('');
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(
    null,
  );

  const [hostForm, setHostForm] = useState({
    id: '',
    label: '',
    host: '',
    username: '',
    port: '22',
    privateKeyPath: '~/.ssh/id_ed25519',
  });
  const [hostTesting, setHostTesting] = useState(false);
  const [hostAdding, setHostAdding] = useState(false);
  const [hostTestStatus, setHostTestStatus] = useState<StatusMessage | null>(
    null,
  );
  const [hostAddStatus, setHostAddStatus] = useState<StatusMessage | null>(null);

  const [collectorForm, setCollectorForm] = useState({
    pollIntervalMs: initialStatus.config.pollIntervalMs ?? 60_000,
    idleWindow: initialStatus.config.idleWindow ?? 5,
    idleThreshold: initialStatus.config.idleThreshold ?? 0.1,
    chartWindowHours: initialStatus.config.chartWindowHours ?? 24,
  });
  const [collectorStatus, setCollectorStatus] = useState<StatusMessage | null>(
    null,
  );
  const [processModal, setProcessModal] = useState<{
    gpu: GpuStatus;
    process: ProcessInfo;
  } | null>(null);
  const [statsWindow, setStatsWindow] = useState<string>('1d');
  const [statsDimension, setStatsDimension] = useState<'host' | 'gpu'>('host');

  const [telegramForm, setTelegramForm] = useState({
    botToken: '',
    chatId: '',
    message: 'GPU Watcher 测试消息',
    disableNotifications: false,
  });
  const [telegramStatus, setTelegramStatus] = useState<StatusMessage | null>(
    null,
  );
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const stored = window.localStorage.getItem('gpuWatcherTheme');
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
    }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('gpuWatcherTheme', theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => setRuntimeSettings(data.settings))
      .catch(() => {
        /* ignore */
      });
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    if (!runtimeSettings) {
      return;
    }
    setCollectorForm({
      pollIntervalMs: runtimeSettings.pollIntervalMs,
      idleWindow: runtimeSettings.idleWindow,
      idleThreshold: runtimeSettings.idleThreshold,
      chartWindowHours: runtimeSettings.chartWindowHours,
    });
    setTelegramForm((prev) => ({
      ...prev,
      chatId: runtimeSettings.telegram.chatId ?? '',
      disableNotifications: runtimeSettings.telegram.disableNotifications,
    }));
  }, [runtimeSettings]);
  const pinnedHosts = useMemo(
    () => runtimeSettings?.pinnedHosts ?? [],
    [runtimeSettings?.pinnedHosts],
  );
  const hiddenHosts = useMemo(
    () => runtimeSettings?.hiddenHosts ?? [],
    [runtimeSettings?.hiddenHosts],
  );
  const hiddenHostSet = useMemo(
    () => new Set(hiddenHosts),
    [hiddenHosts],
  );

  const { data: statusData } = useSWR<StatusResponse>(
    '/api/status',
    fetcher,
    {
      refreshInterval: swrPollInterval,
      fallbackData: initialStatus,
    },
  );

  const { data: eventsData } = useSWR<EventsResponse>(
    '/api/events?limit=50',
    fetcher,
    {
      refreshInterval: 30_000,
      fallbackData: initialEvents,
    },
  );

  const { data: statsData } = useSWR<StatsResponse>(
    '/api/stats',
    fetcher,
    {
      refreshInterval: 300_000,
    },
  );

  const statsWindows = statsData?.windows ?? [];
  const hasSelectedStatsWindow = statsWindows.some(
    (window) => window.id === statsWindow,
  );
  const activeStatsWindowId = hasSelectedStatsWindow
    ? statsWindow
    : statsWindows[0]?.id ?? null;
  const activeStatsWindow = statsWindows.find(
    (window) => window.id === activeStatsWindowId,
  );
  const statsHosts = (statsData?.hosts ?? []).filter(
    (host) => !hiddenHostSet.has(host.hostId),
  );
  const statsGpus = (statsData?.gpus ?? []).filter(
    (gpu) => !hiddenHostSet.has(gpu.hostId),
  );

  useEffect(() => {
    const windowList = statsData?.windows ?? [];
    if (!windowList.length) {
      return;
    }
    if (!windowList.some((window) => window.id === statsWindow)) {
      setStatsWindow(windowList[0].id);
    }
  }, [statsData, statsWindow]);
  const config = statusData?.config ?? initialStatus.config;
  const pollInterval = config.pollIntervalMs ?? swrPollInterval;
  const chartWindowHours = config.chartWindowHours ?? 24;
  const idleThreshold = config.idleThreshold ?? 0.1;
  const processFallback = config.processDisplayMinMemoryMb ?? 0;
  const hostDefinitions = useMemo(
    () => config.hostDefinitions ?? [],
    [config.hostDefinitions],
  );
  const hasHostDefinitions = hostDefinitions.length > 0;
  const allowedHostSet = useMemo(() => {
    if (!hasHostDefinitions) {
      return new Set<string>();
    }
    return new Set(
      hostDefinitions
        .map((definition) => definition.id)
        .filter((id) => !hiddenHostSet.has(id)),
    );
  }, [hostDefinitions, hiddenHostSet, hasHostDefinitions]);

  const hosts = useMemo(
    () => statusData?.hosts ?? [],
    [statusData?.hosts],
  );
  const visibleHosts = useMemo(() => {
    if (hasHostDefinitions) {
      return hosts.filter((host) => allowedHostSet.has(host.hostId));
    }
    if (hiddenHostSet.size === 0) {
      return hosts;
    }
    return hosts.filter((host) => !hiddenHostSet.has(host.hostId));
  }, [hosts, allowedHostSet, hiddenHostSet, hasHostDefinitions]);

  const gpus = useMemo(() => {
    const list = statusData?.gpus ?? [];
    if (hasHostDefinitions) {
      if (allowedHostSet.size === 0) {
        return [];
      }
      return list.filter((gpu) => allowedHostSet.has(gpu.hostId));
    }
    if (hiddenHostSet.size === 0) {
      return list;
    }
    return list.filter((gpu) => !hiddenHostSet.has(gpu.hostId));
  }, [statusData?.gpus, allowedHostSet, hiddenHostSet, hasHostDefinitions]);

  const hostLabels = useMemo(
    () =>
      new Map(
        hostDefinitions.map((definition) => [
          definition.id,
          definition.label ?? definition.id,
        ]),
      ),
    [hostDefinitions],
  );

  const quickGpuList = useMemo(() => {
    if (gpus.length === 0) {
      return [];
    }
    const pinnedSet = new Set(pinnedHosts);
    const weight = (gpu: GpuStatus) => {
      if (gpu.offlineSince) return 2; // 离线最后
      if (gpu.isIdle) return 0; // 空闲优先
      return 1; // 繁忙次之
    };
    return [...gpus]
      .sort((a, b) => {
        const aw = weight(a);
        const bw = weight(b);
        if (aw !== bw) {
          return aw - bw;
        }
        const aPinned = pinnedSet.has(a.hostId);
        const bPinned = pinnedSet.has(b.hostId);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return `${a.hostId}-${a.gpuIndex}`.localeCompare(
          `${b.hostId}-${b.gpuIndex}`,
        );
      })
      .slice(0, 4);
  }, [gpus, pinnedHosts]);

  const hostStatusMap = useMemo(
    () => new Map(hosts.map((host) => [host.hostId, host])),
    [hosts],
  );
  const lastPollTimestamp = useMemo(() => {
    const hostTimes = visibleHosts.map(
      (host) => host.updatedAt ?? host.lastSeen ?? 0,
    );
    const gpuTimes = gpus.map((gpu) => gpu.lastSeen ?? 0);
    const latest = Math.max(0, ...hostTimes, ...gpuTimes);
    return Number.isFinite(latest) && latest > 0 ? latest : null;
  }, [visibleHosts, gpus]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const [manualSelection, setManualSelection] = useState<Selection | null>(
    null,
  );

  const selected = useMemo(() => {
    if (
      manualSelection &&
      gpus.some(
        (gpu) =>
          gpu.hostId === manualSelection.hostId &&
          gpu.gpuIndex === manualSelection.gpuIndex,
      )
    ) {
      return manualSelection;
    }
    const first = gpus[0];
    return first
      ? { hostId: first.hostId, gpuIndex: first.gpuIndex }
      : null;
  }, [manualSelection, gpus]);

  const snapshotKey = selected
    ? `/api/snapshots?hostId=${selected.hostId}&gpuIndex=${selected.gpuIndex}&windowHours=${chartWindowHours}`
    : null;

  const { data: snapshotData } = useSWR<SnapshotResponse>(
    snapshotKey,
    fetcher,
    {
      refreshInterval: 60_000,
    },
  );

  const chartData = snapshotData?.points.map((point) => ({
    timestamp: point.timestamp,
    label: new Date(point.timestamp).toLocaleTimeString(),
    utilization: point.utilizationPct,
    memory: point.memoryPct * 100,
    temperature: point.temperatureC,
  }));

  const groupedGpuEntries = useMemo(() => {
    const map = new Map<string, typeof gpus>();
    for (const gpu of gpus) {
      if (!map.has(gpu.hostId)) {
        map.set(gpu.hostId, []);
      }
      map.get(gpu.hostId)!.push(gpu);
    }
    const placeholderHosts = hasHostDefinitions
      ? Array.from(allowedHostSet)
      : Array.from(new Set(visibleHosts.map((host) => host.hostId)));
    for (const hostId of placeholderHosts) {
      if (!map.has(hostId)) {
        map.set(hostId, []);
      }
    }
    const pinnedSet = new Set(pinnedHosts);
    return Array.from(map.entries()).sort(([a], [b]) => {
      const aPinned = pinnedSet.has(a);
      const bPinned = pinnedSet.has(b);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return (hostLabels.get(a) ?? a).localeCompare(hostLabels.get(b) ?? b);
    });
  }, [gpus, pinnedHosts, hostLabels, hasHostDefinitions, allowedHostSet, visibleHosts]);

  const hostCards = useMemo<HostCard[]>(() => {
    if (hostDefinitions.length === 0) {
      return hosts.map((host) => ({
        ...host,
        hidden: hiddenHostSet.has(host.hostId),
      }));
    }
    const existing = new Map(hosts.map((host) => [host.hostId, host]));
    return hostDefinitions.map((definition) => {
      const hidden = hiddenHostSet.has(definition.id);
      const host = existing.get(definition.id);
      if (host) {
        return { ...host, hidden };
      }
      return {
        hostId: definition.id,
        label: definition.label,
        isOnline: false,
        updatedAt: now,
        pending: true,
        hidden,
      } as HostCard;
    });
  }, [hosts, hostDefinitions, now, hiddenHostSet]);

  const sortedHostCards = useMemo(() => {
    const pinnedSet = new Set(pinnedHosts);
    return [...hostCards].sort((a, b) => {
      const aPinned = pinnedSet.has(a.hostId);
      const bPinned = pinnedSet.has(b.hostId);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return (a.label ?? a.hostId).localeCompare(b.label ?? b.hostId);
    });
  }, [hostCards, pinnedHosts]);

  const selectedGpu = selected
    ? gpus.find(
        (gpu) =>
          gpu.hostId === selected.hostId &&
          gpu.gpuIndex === selected.gpuIndex,
      )
    : null;

  const totalHosts = hasHostDefinitions
    ? allowedHostSet.size
    : visibleHosts.length;
  const onlineHosts = visibleHosts.filter((host) => host.isOnline).length;
  const totalGpus = gpus.length;
  const idleGpus = gpus.filter(
    (gpu) => gpu.isIdle && !gpu.offlineSince,
  ).length;

  const events = eventsData?.events ?? [];
  const hostEvents = events.filter(
    (event) => event.type === 'host_offline' || event.type === 'host_online',
  );
  const processEvents = events.filter(
    (event) => event.type !== 'host_offline' && event.type !== 'host_online',
  );

  const normalizedQuery = timelineQuery.trim().toLowerCase();
  const matchesQuery = (event: GpuEvent) => {
    if (!normalizedQuery) {
      return true;
    }
    const haystack = [
      event.hostId,
      event.gpuIndex ?? '',
      JSON.stringify(event.details ?? {}),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  };

  const filteredHostEvents = hostEvents.filter(matchesQuery);
  const filteredProcessEvents = processEvents.filter(matchesQuery);
  const showHostEvents =
    timelineFilter === 'all' || timelineFilter === 'host';
  const showProcessEvents =
    timelineFilter === 'all' || timelineFilter === 'process';

  const refreshStatus = () => {
    mutate('/api/status');
    mutate('/api/events?limit=50');
  };

  function buildHostPayload() {
    if (!hostForm.id.trim()) {
      throw new Error('请填写主机 ID');
    }
    if (!hostForm.host.trim() || !hostForm.username.trim()) {
      throw new Error('SSH 主机 / 用户名不能为空');
    }
    const port = Number(hostForm.port) || 22;
    return {
      id: hostForm.id.trim(),
      label: hostForm.label?.trim() || undefined,
      connection: {
        type: 'ssh' as const,
        host: hostForm.host.trim(),
        username: hostForm.username.trim(),
        port,
        privateKeyPath: hostForm.privateKeyPath.trim()
          ? hostForm.privateKeyPath.trim()
          : undefined,
      },
    };
  }

  async function handleTestHost() {
    setHostTestStatus(null);
    setHostTesting(true);
    try {
      const payload = buildHostPayload();
      const res = await fetch('/api/tools/test-ssh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? '连接测试失败');
      }
      setHostTestStatus({ type: 'success', text: '连接成功，可添加该主机。' });
    } catch (error) {
      setHostTestStatus({
        type: 'error',
        text: (error as Error).message,
      });
    } finally {
      setHostTesting(false);
    }
  }

  async function handleAddHost() {
    setHostAddStatus(null);
    setHostAdding(true);
    try {
      const payload = buildHostPayload();
      const res = await fetch('/api/hosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? '添加主机失败');
      }
      setHostAddStatus({ type: 'success', text: '主机已加入轮询列表。' });
      setHostForm((prev) => ({
        ...prev,
        id: '',
        label: '',
        host: '',
      }));
      refreshStatus();
    } catch (error) {
      setHostAddStatus({
        type: 'error',
        text: (error as Error).message,
      });
    } finally {
      setHostAdding(false);
    }
  }

  async function handleRemoveHost(hostId: string) {
    await fetch(`/api/hosts?id=${encodeURIComponent(hostId)}`, {
      method: 'DELETE',
    });
    refreshStatus();
  }

  async function handleTogglePin(hostId: string) {
    const nextPinned = new Set(pinnedHosts);
    if (nextPinned.has(hostId)) {
      nextPinned.delete(hostId);
    } else {
      nextPinned.add(hostId);
    }
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinnedHosts: Array.from(nextPinned) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? '更新置顶状态失败');
      }
      const data = await res.json();
      setRuntimeSettings(data.settings);
    } catch (error) {
      console.error('Failed to pin host', error);
    }
  }

  async function handleToggleVisibility(hostId: string) {
    const nextHidden = new Set(hiddenHosts);
    if (nextHidden.has(hostId)) {
      nextHidden.delete(hostId);
    } else {
      nextHidden.add(hostId);
    }
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hiddenHosts: Array.from(nextHidden) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? '更新可见性失败');
      }
      const data = await res.json();
      setRuntimeSettings(data.settings);
      refreshStatus();
    } catch (error) {
      console.error('Failed to toggle visibility', error);
    }
  }

  async function handleSaveCollector() {
    setCollectorStatus(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pollIntervalMs: collectorForm.pollIntervalMs,
          idleWindow: collectorForm.idleWindow,
          idleThreshold: collectorForm.idleThreshold,
          chartWindowHours: collectorForm.chartWindowHours,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? '保存失败');
      }
      const data = await res.json();
      setRuntimeSettings(data.settings);
      setCollectorStatus({ type: 'success', text: '采集参数已更新。' });
      refreshStatus();
    } catch (error) {
      setCollectorStatus({
        type: 'error',
        text: (error as Error).message,
      });
    }
  }

  async function handleSendTelegramTest() {
    setTelegramStatus(null);
    if (!telegramForm.botToken.trim() || !telegramForm.chatId.trim()) {
      setTelegramStatus({
        type: 'error',
        text: '请填写 Bot Token 和 Chat ID',
      });
      return;
    }
    try {
      const res = await fetch('/api/tools/test-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: telegramForm.botToken.trim(),
          chatId: telegramForm.chatId.trim(),
          message: telegramForm.message.trim() || 'GPU Watcher 测试消息',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? '发送失败');
      }
      setTelegramStatus({ type: 'success', text: '测试消息已发送。' });
    } catch (error) {
      setTelegramStatus({
        type: 'error',
        text: (error as Error).message,
      });
    }
  }

  async function handleSaveTelegramSettings() {
    setTelegramStatus(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram: {
            botToken: telegramForm.botToken.trim() || undefined,
            chatId: telegramForm.chatId.trim() || undefined,
            disableNotifications: telegramForm.disableNotifications,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? '保存失败');
      }
      const data = await res.json();
      setRuntimeSettings(data.settings);
      setTelegramStatus({ type: 'success', text: 'Telegram 配置已更新。' });
      refreshStatus();
    } catch (error) {
      setTelegramStatus({
        type: 'error',
        text: (error as Error).message,
      });
    }
  }

  const sidebar = (
    <aside
      className={classNames(
        'hidden h-full w-72 flex-shrink-0 flex-col overflow-y-auto rounded-3xl border p-6 shadow-[0_25px_60px_rgba(15,23,42,0.18)] xl:flex',
        themed(
          'border-transparent bg-gradient-to-b from-white/95 via-[#e4edff]/90 to-[#ffeef8]/85 text-slate-700',
          'border-slate-800 bg-gradient-to-b from-[#070b16]/95 via-[#0c1424]/95 to-[#111827]/95 text-slate-100',
        ),
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={classNames(
            'h-12 w-12 rounded-2xl text-xl font-bold text-white shadow-xl shadow-indigo-200/60',
            themed(
              'bg-[radial-gradient(circle_at_top,_#60a5fa,_#a855f7_55%,_#fb7185)]',
              'bg-[radial-gradient(circle_at_top,_#1f2937,_#3b82f6_60%,_#9d174d)]',
            ),
          )}
        >
          <div className="flex h-full items-center justify-center tracking-wide">
            GW
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
            GPU Watcher
          </p>
          <p className="text-lg font-semibold text-slate-900">控制面板</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        className={classNames(
          'mt-6 w-full rounded-2xl border px-4 py-2 text-sm font-semibold transition',
          themed(
            'border-transparent bg-gradient-to-r from-[#c7d2fe] via-[#fecdd3] to-[#fde68a] text-slate-800 hover:scale-[1.01]',
            'border-slate-700 bg-gradient-to-r from-[#1e1b4b] via-[#0f172a] to-[#083344] text-slate-200 hover:scale-[1.01]',
          ),
        )}
      >
        当前主题：{isDark ? '深色' : '浅色'}
      </button>
      <nav className="mt-6 space-y-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveView(item.id)}
            className={classNames(
              'w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold transition',
              activeView === item.id
                ? themed(
                    'bg-white text-slate-900 shadow-lg shadow-indigo-100',
                    'bg-slate-800 text-white shadow-lg shadow-slate-900/40',
                  )
                : themed(
                    'bg-white/70 text-slate-500 hover:bg-white',
                    'bg-slate-900 text-slate-400 hover:bg-slate-800',
                  ),
            )}
          >
            <p>{item.label}</p>
            <p className="text-xs font-normal text-slate-400">{item.description}</p>
          </button>
        ))}
      </nav>
    </aside>
  );

  const lastPollLabel = lastPollTimestamp
    ? formatDateTime(lastPollTimestamp)
    : '等待采样';

  const homeView = (
    <div className="space-y-4">
      <div
        className={classNames(
          'relative overflow-hidden rounded-[32px] border text-slate-900 shadow-[0_35px_90px_rgba(56,189,248,0.25)]',
          themed(
            'border-transparent bg-[radial-gradient(circle_at_top,_#e0f2ff_0%,_#fdf2ff_55%,_#ffffff_95%)]',
            'border-slate-800 bg-[radial-gradient(circle_at_top,_#0b1222,_0%,_#020617_75%)] text-slate-100',
          ),
        )}
      >
        <div className="relative z-10 grid gap-6 p-6 lg:grid-cols-2">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
              GPU Watcher
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-900">
              统一管理多台 GPU 主机，实时掌握显卡状态与任务动态。
            </h1>
            <p className="mt-4 text-sm text-slate-500">
              通过 SSH 拉取 nvidia-smi，无需在远端部署额外进程。支持 Telegram
              告警、事件时间线、24 小时曲线以及进程上下线追踪。
            </p>
            <div className="mt-6 flex flex-wrap gap-4 text-sm">
              <div className={classNames('rounded-2xl border px-4 py-3', softCardClass)}>
                <p>在线主机</p>
                <p className="text-2xl font-semibold text-slate-900 dark:text-white">
                  {onlineHosts}/{totalHosts}
                </p>
              </div>
              <div className={classNames('rounded-2xl border px-4 py-3', softCardClass)}>
                <p>空闲 GPU</p>
                <p className="text-2xl font-semibold text-slate-900 dark:text-white">
                  {idleGpus}/{totalGpus}
                </p>
              </div>
              <div className={classNames('rounded-2xl border px-4 py-3', softCardClass)}>
                <p>最新事件</p>
                <p className="text-2xl font-semibold text-slate-900 dark:text-white">
                  {(eventsData?.events.length ?? 0).toString().padStart(2, '0')}
                </p>
              </div>
              <div className={classNames('rounded-2xl border px-4 py-3', softCardClass)}>
                <p>最近轮询</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {lastPollLabel}
                </p>
              </div>
            </div>
          </div>
          <div
            className={classNames(
              'flex flex-col gap-4 rounded-3xl border p-6 backdrop-blur',
              themed(
                'border-white/60 bg-white/80 shadow-[0_25px_45px_rgba(99,102,241,0.15)]',
                'border-slate-800 bg-slate-900/70 shadow-[0_25px_45px_rgba(15,118,110,0.25)]',
              ),
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-widest text-slate-400">
                GPU 快速概览
              </p>
              <p className="text-[11px] text-slate-400">
                最近轮询：{lastPollLabel}
              </p>
            </div>
            <div className="mt-4 space-y-3">
              {quickGpuList.length > 0 ? (
                quickGpuList.map((gpu) => {
                  const hostLabel = hostLabels.get(gpu.hostId) ?? gpu.hostId;
                  const artwork = getGpuArtwork(gpu.gpuName);
                  const icon = cloneElement(artwork.icon, {
                    className: classNames(
                      'h-10 w-10',
                      artwork.icon.props?.className,
                    ),
                  });
                  const hasMemoryData =
                    typeof gpu.memoryTotalMb === 'number' &&
                    gpu.memoryTotalMb > 0 &&
                    typeof gpu.lastMemoryUsedMb === 'number';
                  const memoryPct = hasMemoryData
                    ? Math.round(
                        (gpu.lastMemoryUsedMb! / gpu.memoryTotalMb!) * 100,
                      )
                    : null;
                  const statusBadge = gpu.offlineSince
                    ? themed(
                        'bg-rose-100 text-rose-600',
                        'bg-rose-500/20 text-rose-200',
                      )
                    : gpu.isIdle
                    ? themed(
                        'bg-amber-100 text-amber-700',
                        'bg-amber-500/20 text-amber-200',
                      )
                    : themed(
                        'bg-sky-100 text-sky-700',
                        'bg-sky-500/20 text-sky-200',
                      );
                  const statusLabel = gpu.offlineSince
                    ? '离线'
                    : gpu.isIdle
                    ? '空闲'
                    : '繁忙';
                  const quickSurface = themed(
                    'border-white/70 bg-white/85',
                    'border-slate-700 bg-slate-900/70',
                  );
                  return (
                    <div
                      key={`${gpu.hostId}-${gpu.gpuIndex}-quick`}
                      className={classNames(
                        'flex items-center gap-3 rounded-2xl border px-3 py-3 backdrop-blur',
                        quickSurface,
                      )}
                    >
                      <div
                        className={classNames(
                          'flex h-12 w-12 items-center justify-center rounded-xl border',
                          themed(
                            'border-white/70 bg-white',
                            'border-slate-700 bg-slate-900',
                          ),
                        )}
                      >
                        {icon}
                      </div>
                      <div className="flex-1 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {hostLabel} · GPU {gpu.gpuIndex}
                          </p>
                          <span
                            className={classNames(
                              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                              statusBadge,
                            )}
                          >
                            {statusLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          型号 {gpu.gpuName} · 利用率{' '}
                          {gpu.lastUtilizationPct ?? 'N/A'}% · 显存{' '}
                          {memoryPct ?? 'N/A'}% · 进程 {gpu.processes.length}
                        </p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-slate-500">等待 GPU 数据…</p>
              )}
            </div>
            <div className="grid gap-3 text-sm text-slate-600 lg:grid-cols-2">
              <div
                className={classNames(
                  'rounded-2xl border px-4 py-3',
                  themed(
                    'border-white/60 bg-white/70 text-slate-600',
                    'border-slate-700 bg-slate-900 text-slate-300',
                  ),
                )}
              >
                <p>轮询周期</p>
                <p className="text-xl font-semibold text-slate-900 dark:text-white">
                  {Math.round(pollInterval / 1000)} 秒
                </p>
              </div>
              <div
                className={classNames(
                  'rounded-2xl border px-4 py-3',
                  themed(
                    'border-white/60 bg-white/70 text-slate-600',
                    'border-slate-700 bg-slate-900 text-slate-300',
                  ),
                )}
              >
                <p>空闲判定</p>
                <p className="text-xl font-semibold text-slate-900 dark:text-white">
                  {config.idleWindow ?? 5} 次 &lt; {(idleThreshold * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            title: 'SSH 轮询',
            subtitle: '不侵入远端',
            desc: '本机通过 SSH 并发执行 nvidia-smi，远端零依赖，可随时添加/删除主机。',
          },
          {
            title: '事件追踪',
            subtitle: '进程上下线、GPU 空闲',
            desc: 'SQLite 持久化所有事件，配合 Telegram 推送及时通知。',
          },
          {
            title: '24 小时曲线',
            subtitle: '利用率 / 显存 / 温度',
            desc: '可切换单条曲线，帮助分析波峰波谷与队列瓶颈。',
          },
        ].map((card) => (
          <div
            key={card.title}
            className={classNames('rounded-2xl border p-4 shadow-sm', softCardClass)}
          >
            <p className="text-sm">{card.title}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
              {card.subtitle}
            </p>
            <p className="mt-2 text-sm">{card.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );

  function renderProcessSection(
    gpu: GpuStatus,
    filteredProcesses: ProcessInfo[],
    processThreshold: number,
    palette: { primary: string; secondary: string; metric: string },
    hiddenProcesses: number,
  ) {
    if (filteredProcesses.length === 0) {
      return (
        <>
          <p className={classNames('mt-3 text-xs', palette.secondary)}>
            暂无显存 ≥ {processThreshold} MiB 的进程
          </p>
          {hiddenProcesses > 0 && (
            <p className="mt-1 text-[11px] text-slate-400">
              已隐藏 {hiddenProcesses} 个低显存进程
            </p>
          )}
        </>
      );
    }

    return (
      <>
        <div
          className={classNames(
            'mt-3 rounded-2xl border',
            themed('border-slate-200 bg-white', 'border-slate-700 bg-slate-900'),
          )}
        >
          <div
            className={classNames(
              'grid grid-cols-[minmax(80px,1fr)_minmax(140px,2fr)_minmax(60px,1fr)] gap-2 rounded-t-2xl px-3 py-2 text-[11px] font-semibold uppercase tracking-wide',
              themed('bg-slate-50 text-slate-500', 'bg-slate-800 text-slate-300'),
            )}
          >
            <span>PID</span>
            <span>命令</span>
            <span className="text-right">显存</span>
          </div>
          <div
            className={classNames(
              'max-h-56 divide-y overflow-y-auto',
              themed('divide-slate-100', 'divide-slate-800'),
            )}
          >
            {filteredProcesses.map((proc) => {
              const runtime =
                proc.startedAt !== undefined
                  ? formatDuration(now - proc.startedAt)
                  : 'N/A';
              return (
                <button
                  key={proc.pid}
                  type="button"
                  onClick={() => setProcessModal({ gpu, process: proc })}
                  className={classNames(
                    'grid w-full grid-cols-[minmax(80px,1fr)_minmax(140px,2fr)_minmax(60px,1fr)] gap-2 px-3 py-2 text-left text-xs',
                    themed(
                      'text-slate-600 hover:bg-slate-50',
                      'text-slate-200 hover:bg-slate-800',
                    ),
                  )}
                >
                  <span
                    className={classNames(
                      'font-mono',
                      themed('text-slate-900', 'text-slate-100'),
                    )}
                  >
                    #{proc.pid}
                  </span>
                  <div className="space-y-1">
                    <p
                      className={classNames(
                        'break-words font-semibold',
                        themed('text-slate-800', 'text-slate-100'),
                      )}
                    >
                      {proc.command ?? proc.name}
                    </p>
                    <p
                      className={classNames(
                        'text-[11px]',
                        themed('text-slate-500', 'text-slate-300'),
                      )}
                    >
                      执行者：{proc.ownerHint ?? proc.hostUser ?? proc.username ?? '未知'}
                      {proc.containerName
                        ? ` · 容器 ${proc.containerName}`
                        : proc.containerId
                        ? ` · 容器 ${proc.containerId}`
                        : ''}
                    </p>
                    <p
                      className={classNames(
                        'text-[11px]',
                        themed('text-slate-500', 'text-slate-300'),
                      )}
                    >
                      用户 {proc.username ?? proc.hostUser ?? '未知'} · 运行 {runtime}
                    </p>
                  </div>
                  <span
                    className={classNames(
                      'text-right font-mono text-sm',
                      themed('text-slate-900', 'text-slate-100'),
                    )}
                  >
                    {proc.memoryUsedMb} MiB
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {hiddenProcesses > 0 && (
          <p className="mt-1 text-[11px] text-slate-400">
            已隐藏 {hiddenProcesses} 个低显存进程
          </p>
        )}
      </>
    );
  }

  function renderGpuCard(gpu: GpuStatus, hostLabel: string) {
    const artwork = getGpuArtwork(gpu.gpuName);
    const hasMemoryData =
      typeof gpu.memoryTotalMb === 'number' &&
      gpu.memoryTotalMb > 0 &&
      typeof gpu.lastMemoryUsedMb === 'number';
    const memoryRatio = hasMemoryData
      ? gpu.lastMemoryUsedMb! / gpu.memoryTotalMb!
      : undefined;
    const dynamicThreshold = hasMemoryData
      ? Math.round(gpu.memoryTotalMb! * idleThreshold)
      : processFallback;
    const processThreshold = Math.max(dynamicThreshold, processFallback);
    const filteredProcesses = gpu.processes.filter(
      (proc) => proc.memoryUsedMb >= processThreshold,
    );
    const hiddenProcesses = gpu.processes.length - filteredProcesses.length;
    const isSelected =
      Boolean(selected) &&
      selected?.hostId === gpu.hostId &&
      selected?.gpuIndex === gpu.gpuIndex;
    const statusKey: keyof typeof statusBadgeStyles = gpu.offlineSince
      ? 'offline'
      : gpu.isIdle
      ? 'idle'
      : 'busy';
    const statusVariant =
      statusBadgeStyles[statusKey][isSelected ? 'selected' : 'default'];
    const idleDurationLabel =
      gpu.isIdle && gpu.idleSince
        ? formatDuration(now - gpu.idleSince)
        : gpu.isIdle
        ? '刚空闲'
        : '—';
    const palette = {
      primary: isSelected
        ? themed('text-indigo-900', 'text-indigo-200')
        : themed('text-slate-900', 'text-slate-100'),
      secondary: isSelected
        ? themed('text-indigo-600', 'text-indigo-300')
        : themed('text-slate-500', 'text-slate-400'),
      metric: isSelected
        ? themed('text-indigo-900', 'text-indigo-200')
        : themed('text-slate-900', 'text-slate-100'),
    };
    const cardSurface = isSelected
      ? themed(
          'border-transparent bg-gradient-to-br from-[#dbeafe] via-[#ede9fe] to-[#fff7ed] shadow-[0_25px_45px_rgba(79,70,229,0.25)]',
          'border-indigo-800 bg-gradient-to-br from-[#0f172a] via-[#111827] to-[#0b1120] shadow-[0_25px_45px_rgba(15,118,110,0.35)]',
        )
      : themed(
          'border-white/70 bg-white/95 shadow-[0_18px_40px_rgba(15,23,42,0.08)]',
          'border-slate-800 bg-slate-950 shadow-[0_18px_40px_rgba(2,6,23,0.65)]',
        );
    const accentPanel = isSelected
      ? themed(
          'border border-white/70 bg-white/80',
          'border border-slate-700 bg-slate-900/80',
        )
      : themed(
          'bg-gradient-to-r from-[#eef2ff] to-[#fff7ed]',
          'bg-gradient-to-r from-[#0f172a] to-[#0b1120]',
        );
    const iconWrap = isSelected
      ? themed('border-white/70 bg-white', 'border-slate-600 bg-slate-900')
      : themed('border-white/80 bg-white', 'border-slate-800 bg-slate-900');

    return (
      <button
        key={`${gpu.hostId}-${gpu.gpuIndex}`}
        type="button"
        onClick={() =>
          setManualSelection({
            hostId: gpu.hostId,
            gpuIndex: gpu.gpuIndex,
          })
        }
        className={classNames(
          'flex h-full flex-col rounded-2xl border p-4 text-left shadow-sm transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200',
          cardSurface,
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={classNames('text-sm font-semibold', palette.primary)}>
              GPU {gpu.gpuIndex}
            </p>
            <p className={classNames('text-[11px]', palette.secondary)}>
              {gpu.gpuName}
            </p>
          </div>
          <span
            className={classNames(
              'rounded-full px-2 py-0.5 text-xs font-semibold',
              statusVariant,
            )}
          >
            {gpu.offlineSince ? '离线' : gpu.isIdle ? '空闲' : '繁忙'}
          </span>
        </div>
        <div
          className={classNames(
            'mt-2 flex items-center gap-3 rounded-2xl p-2.5',
            accentPanel,
          )}
        >
          <div
            className={classNames(
              'flex h-14 w-14 items-center justify-center rounded-xl border',
              iconWrap,
            )}
          >
            {artwork.icon}
          </div>
          <div className={classNames('text-xs', palette.secondary)}>
            <p className={classNames('font-semibold', palette.primary)}>
              {artwork.label}
            </p>
            <p className={palette.secondary}>
              GPU {gpu.gpuIndex} · {hostLabel}
            </p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-[11px] uppercase text-slate-400">GPU 利用率</p>
            <p className={classNames('font-mono text-sm', palette.metric)}>
              {gpu.lastUtilizationPct ?? 'N/A'}%
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-slate-400">显存</p>
            <p className={classNames('font-mono text-sm', palette.metric)}>
              {hasMemoryData
                ? `${gpu.lastMemoryUsedMb!}/${gpu.memoryTotalMb!} (${Math.round(
                    (memoryRatio ?? 0) * 100,
                  )}%)`
                : 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-slate-400">温度</p>
            <p className={classNames('font-mono text-sm', palette.metric)}>
              {gpu.lastTemperatureC ?? 'N/A'} °C
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-slate-400">空闲时长</p>
            <p className={classNames('font-mono text-sm', palette.metric)}>
              {idleDurationLabel}
            </p>
          </div>
        </div>
        {renderProcessSection(
          gpu,
          filteredProcesses,
          processThreshold,
          palette,
          hiddenProcesses,
        )}
      </button>
    );
  }

  function renderHostSection([hostId, gpuList]: [string, GpuStatus[]]) {
    const hostLabel = hostLabels.get(hostId) ?? hostId;
    const hostStatus = hostStatusMap.get(hostId);
    const pinned = pinnedHosts.includes(hostId);
    const hostBadge = hostStatus
      ? hostStatus.isOnline
        ? themed('bg-emerald-50 text-emerald-700', 'bg-emerald-500/20 text-emerald-200')
        : themed('bg-rose-50 text-rose-700', 'bg-rose-500/20 text-rose-200')
      : themed('bg-slate-100 text-slate-500', 'bg-slate-800 text-slate-300');
    const hostBadgeLabel = hostStatus
      ? hostStatus.isOnline
        ? '在线'
        : '离线'
      : '待采样';

    return (
      <div
        key={hostId}
        className={classNames('rounded-2xl border p-4 shadow-sm', primaryCardClass)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3
              className={classNames(
                'text-lg font-semibold',
                themed('text-slate-900', 'text-slate-100'),
              )}
            >
              {hostLabel}
            </h3>
            {pinned && <span className="text-amber-500 text-sm">★</span>}
          </div>
          <span
            className={classNames(
              'rounded-full px-3 py-0.5 text-xs font-semibold',
              hostBadge,
            )}
          >
            {hostBadgeLabel}
          </span>
        </div>
        {gpuList.length === 0 ? (
          <div
            className={classNames(
              'mt-3 rounded-2xl border border-dashed p-4 text-sm',
              themed(
                'border-slate-200 bg-white text-slate-500',
                'border-slate-700 bg-slate-900 text-slate-300',
              ),
            )}
          >
            暂无 GPU 数据，{hostStatus?.isOnline ? '等待采样…' : '主机离线或未采集'}。
          </div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {gpuList.map((gpu) => renderGpuCard(gpu, hostLabel))}
          </div>
        )}
      </div>
    );
  }

  const gpuView = (
    <div className="space-y-4">
      <div className={classNames('rounded-2xl border p-4 shadow-sm', primaryCardClass)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              最近 24 小时监控曲线
            </h2>
            <p className="text-sm text-slate-500">
              {selectedGpu
                ? `${selectedGpu.hostId} · GPU ${selectedGpu.gpuIndex} · ${selectedGpu.gpuName}`
                : '请选择任意 GPU 观察趋势'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {['all', 'utilization', 'memory', 'temperature'].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setChartMode(key as typeof chartMode)}
                className={classNames(
                  'rounded-full px-3 py-1 text-xs font-semibold',
                  chartMode === key
                    ? themed('bg-slate-900 text-white', 'bg-white text-slate-900')
                    : themed('bg-slate-100 text-slate-600', 'bg-slate-800 text-slate-200'),
                )}
              >
                {key === 'all'
                  ? '全部曲线'
                  : metricConfig[key as keyof typeof metricConfig].label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 h-64">
          {selected && chartData ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="label" minTickGap={40} />
                <YAxis domain={[0, 110]} />
                <Tooltip />
                {(['utilization', 'memory', 'temperature'] as const).map(
                  (metric) =>
                    (chartMode === 'all' || chartMode === metric) && (
                      <Line
                        key={metric}
                        type="monotone"
                        dataKey={metricConfig[metric].dataKey}
                        name={metricConfig[metric].label}
                        stroke={metricConfig[metric].color}
                        strokeWidth={2}
                        dot={false}
                      />
                    ),
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              {selected ? '加载曲线数据…' : '请先选择一块 GPU'}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-3">
        {groupedGpuEntries.map((entry) => renderHostSection(entry))}
      </div>
    </div>
  );

  const hostsView = (
    <div className={classNames('rounded-2xl border p-4 shadow-sm', primaryCardClass)}>
      <h2 className="text-xl font-semibold text-slate-900">主机状态</h2>
      <p
        className={classNames(
          'text-sm',
          themed('text-slate-500', 'text-slate-400'),
        )}
      >
        动态列表来自配置与实时心跳，可直接在设置页新增主机。
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sortedHostCards.map((host) => {
          const pinned = pinnedHosts.includes(host.hostId);
          const hidden = hiddenHostSet.has(host.hostId);
          return (
            <div
              key={host.hostId}
              className={classNames(
                'rounded-2xl border p-4 transition',
                themed(
                  'border-white/60 bg-gradient-to-br from-white to-[#f6f9ff]',
                  'border-slate-700 bg-slate-900',
                ),
                hidden && 'opacity-60',
              )}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p
                    className={classNames(
                      'text-sm font-semibold',
                      themed('text-slate-900', 'text-slate-100'),
                    )}
                  >
                    {host.label ?? host.hostId}
                  </p>
                  <p className={classNames('text-xs', themed('text-slate-500', 'text-slate-400'))}>
                    {host.hostId}
                  </p>
                </div>
                <span
                  className={classNames(
                    'rounded-full px-3 py-0.5 text-xs font-semibold',
                    hidden
                      ? themed('bg-slate-200 text-slate-600', 'bg-slate-800 text-slate-300')
                      : host.pending
                      ? themed('bg-slate-100 text-slate-500', 'bg-slate-800 text-slate-300')
                      : host.isOnline
                      ? themed('bg-emerald-50 text-emerald-700', 'bg-emerald-500/20 text-emerald-200')
                      : themed('bg-rose-50 text-rose-700', 'bg-rose-500/20 text-rose-200'),
                  )}
                >
                  {hidden
                    ? '已隐藏'
                    : host.pending
                    ? '待采样'
                    : host.isOnline
                    ? '在线'
                    : '离线'}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleTogglePin(host.hostId)}
                    className={classNames(
                      'rounded-full border px-3 py-0.5',
                      themed(
                        'border-slate-300 text-slate-600 hover:bg-slate-100',
                        'border-slate-700 text-slate-200 hover:bg-slate-800',
                      ),
                    )}
                  >
                    {pinned ? '取消置顶' : '置顶'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleVisibility(host.hostId)}
                    className={classNames(
                      'rounded-full border px-3 py-0.5',
                      themed(
                        'border-slate-300 text-slate-600 hover:bg-slate-100',
                        'border-slate-700 text-slate-200 hover:bg-slate-800',
                      ),
                    )}
                  >
                    {hidden ? '设为可见' : '设为隐藏'}
                  </button>
                </div>
                {pinned && (
                  <span className={classNames('text-amber-500', themed('', 'text-amber-300'))}>
                    ★ 已置顶
                  </span>
                )}
              </div>
              <div
                className={classNames(
                  'mt-3 text-xs',
                  themed('text-slate-500', 'text-slate-400'),
                )}
              >
                {host.pending ? (
                <p>等待第一条数据…</p>
              ) : (
                <>
                  {host.lastSeen && (
                    <p>最后成功：{formatDateTime(host.lastSeen)}</p>
                  )}
                  {!host.isOnline && host.offlineSince && (
                    <p>
                      离线时长：{formatDuration(now - host.offlineSince)}
                    </p>
                  )}
                  {host.lastError && (
                    <p className={classNames('text-rose-500', themed('', 'text-rose-300'))}>
                      错误：{host.lastError}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="mt-3 flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setHostForm((prev) => ({
                    ...prev,
                    id: host.hostId,
                    label: host.label ?? '',
                  }));
                  setActiveView('settings');
                }}
                className={classNames(
                  'flex-1 rounded-full border px-3 py-1 text-center',
                  themed(
                    'border-slate-300 text-slate-600 hover:bg-slate-100',
                    'border-slate-700 text-slate-200 hover:bg-slate-800',
                  ),
                )}
              >
                编辑
              </button>
              <button
                type="button"
                onClick={() => handleRemoveHost(host.hostId)}
                className={classNames(
                  'flex-1 rounded-full border px-3 py-1 text-center',
                  themed(
                    'border-rose-200 text-rose-600 hover:bg-rose-50',
                    'border-rose-400 text-rose-200 hover:bg-rose-900/30',
                  ),
                )}
              >
                删除
              </button>
            </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const timelineView = (
    <div className="space-y-3">
      <div
        className={classNames(
          'flex flex-wrap items-center gap-3 rounded-2xl border p-3 shadow-sm',
          primaryCardClass,
        )}
      >
        <input
          type="text"
          placeholder="搜索 host / GPU / 事件内容"
          value={timelineQuery}
          onChange={(event) => setTimelineQuery(event.target.value)}
          className={classNames(
            'flex-1 rounded-full border px-4 py-2 text-sm',
            themed(
              'border-slate-300 bg-white text-slate-900',
              'border-slate-700 bg-slate-900 text-slate-100',
            ),
          )}
        />
        <div className="flex gap-2">
          {['all', 'host', 'process'].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                setTimelineFilter(key as typeof timelineFilter)
              }
              className={classNames(
                'rounded-full px-3 py-1 text-xs font-semibold',
                timelineFilter === key
                  ? themed('bg-slate-900 text-white', 'bg-white text-slate-900')
                  : themed('bg-slate-100 text-slate-600', 'bg-slate-800 text-slate-200'),
              )}
            >
              {key === 'all'
                ? '全部'
                : key === 'host'
                ? '仅主机'
                : '仅进程'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {showHostEvents && (
          <div className={classNames('rounded-2xl border p-4 shadow-sm', primaryCardClass)}>
            <h3 className="text-lg font-semibold text-slate-900">Host 事件</h3>
            <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-2 text-sm">
              {filteredHostEvents.length === 0 ? (
                <p className="text-slate-500">暂无符合条件的主机事件。</p>
              ) : (
                filteredHostEvents.map((event) => (
                  <div
                    key={event.id}
                    className={classNames(
                      'rounded-2xl border p-3',
                      themed(
                        'border-slate-100 bg-white',
                        'border-slate-800 bg-slate-950',
                      ),
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={classNames(
                          'font-semibold',
                          themed('text-slate-900', 'text-slate-100'),
                        )}
                      >
                        {event.type}
                      </span>
                      <span className={classNames('text-xs', themed('text-slate-500', 'text-slate-400'))}>
                        {formatDateTime(event.createdAt)}
                      </span>
                    </div>
                    <p className={classNames('text-xs', themed('text-slate-500', 'text-slate-400'))}>
                      Host: {event.hostId}
                    </p>
                    <pre
                      className={classNames(
                        'mt-2 overflow-auto rounded p-2 text-[11px]',
                        themed('bg-slate-50 text-slate-600', 'bg-slate-900 text-slate-200'),
                      )}
                    >
                      {JSON.stringify(event.details, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {showProcessEvents && (
          <div className={classNames('rounded-2xl border p-4 shadow-sm', primaryCardClass)}>
            <h3 className="text-lg font-semibold text-slate-900">Process / GPU 事件</h3>
            <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-2 text-sm">
              {filteredProcessEvents.length === 0 ? (
                <p className="text-slate-500">暂无符合条件的事件。</p>
              ) : (
                filteredProcessEvents.map((event) => (
                  <div
                    key={event.id}
                    className={classNames(
                      'rounded-2xl border p-3',
                      themed(
                        'border-slate-100 bg-white',
                        'border-slate-800 bg-slate-950',
                      ),
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={classNames(
                          'font-semibold',
                          themed('text-slate-900', 'text-slate-100'),
                        )}
                      >
                        {event.type}
                      </span>
                      <span className={classNames('text-xs', themed('text-slate-500', 'text-slate-400'))}>
                        {formatDateTime(event.createdAt)}
                      </span>
                    </div>
                    <p className={classNames('text-xs', themed('text-slate-500', 'text-slate-400'))}>
                      Host: {event.hostId}
                      {event.gpuIndex !== null && ` · GPU ${event.gpuIndex}`}
                    </p>
                    <pre
                      className={classNames(
                        'mt-2 overflow-auto rounded p-2 text-[11px]',
                        themed('bg-slate-50 text-slate-600', 'bg-slate-900 text-slate-200'),
                      )}
                    >
                      {JSON.stringify(event.details, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const statsItems = useMemo(() => {
    const base: Array<HostUsageStats | GpuUsageStats> =
      statsDimension === 'host' ? statsHosts : statsGpus;
    if (!activeStatsWindowId) {
      return base;
    }
    return [...base].sort((a, b) => {
      const aUsage = a.windows[activeStatsWindowId]?.usageRatio ?? 0;
      const bUsage = b.windows[activeStatsWindowId]?.usageRatio ?? 0;
      return bUsage - aUsage;
    });
  }, [statsDimension, statsHosts, statsGpus, activeStatsWindowId]);
  const statsView = (
    <div className="space-y-4">
      <div className={classNames('rounded-2xl border p-4 shadow-sm', primaryCardClass)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              className={classNames(
                'text-xl font-semibold',
                themed('text-slate-900', 'text-slate-100'),
              )}
            >
              使用统计
            </h2>
            <p className={classNames('text-sm', themed('text-slate-500', 'text-slate-400'))}>
              {activeStatsWindow?.label ?? '等待采样覆盖'}
            </p>
          </div>
          <div
            className={classNames(
              'flex rounded-full border p-0.5 text-xs font-semibold',
              themed(
                'border-white/80 bg-white/70 text-slate-600',
                'border-slate-700 bg-slate-900 text-slate-200',
              ),
            )}
          >
            {(['host', 'gpu'] as const).map((dimension) => (
              <button
                key={dimension}
                type="button"
                onClick={() => setStatsDimension(dimension)}
                className={classNames(
                  'rounded-full px-3 py-1 transition',
                  statsDimension === dimension
                    ? themed('bg-slate-900 text-white', 'bg-white text-slate-900')
                    : themed('text-slate-600', 'text-slate-300'),
                )}
              >
                {dimension === 'host' ? '按主机' : '按 GPU'}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {statsWindows.length > 0 ? (
            statsWindows.map((window) => (
              <button
                key={window.id}
                type="button"
                onClick={() => setStatsWindow(window.id)}
                className={classNames(
                  'rounded-full px-3 py-1 text-xs font-semibold',
                  activeStatsWindowId === window.id
                    ? themed('bg-slate-900 text-white', 'bg-white text-slate-900')
                    : themed('bg-slate-100 text-slate-600', 'bg-slate-800 text-slate-200'),
                )}
              >
                {window.label}
              </button>
            ))
          ) : (
            <span
              className={classNames(
                'text-xs',
                themed('text-slate-500', 'text-slate-400'),
              )}
            >
              暂无窗口配置
            </span>
          )}
        </div>
        {activeStatsWindowId && statsItems.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr
                  className={classNames(
                    'text-left text-[11px] uppercase tracking-wide',
                    themed('text-slate-500', 'text-slate-400'),
                  )}
                >
                  <th className="pb-2 pr-4 font-semibold">
                    {statsDimension === 'host' ? '主机' : 'GPU'}
                  </th>
                  {statsDimension === 'host' ? (
                    <th className="pb-2 pr-4 font-semibold">GPU 数</th>
                  ) : (
                    <th className="pb-2 pr-4 font-semibold">型号</th>
                  )}
                  <th className="pb-2 pr-4 font-semibold">使用时长</th>
                  <th className="pb-2 pr-4 font-semibold">占比</th>
                  <th className="pb-2 pr-4 font-semibold">平均利用率</th>
                  <th className="pb-2 pr-4 font-semibold">平均显存</th>
                  <th className="pb-2 pr-4 font-semibold">数据覆盖</th>
                </tr>
              </thead>
              <tbody>
                {statsItems.map((item) => {
                  const windowStats = item.windows[activeStatsWindowId];
                  if (!windowStats) {
                    return null;
                  }
                  const usageHours = formatHours(windowStats.usageMs);
                  const usageRatio = formatPercentValue(windowStats.usageRatio * 100);
                  const averageUtil = formatPercentValue(
                    windowStats.averageUtilizationPct,
                  );
                  const averageMemory = formatPercentValue(
                    windowStats.averageMemoryPct,
                  );
                  const coverageRatio =
                    windowStats.capacityMs > 0
                      ? windowStats.coverageMs / windowStats.capacityMs
                      : 0;
                  const coverageLabel = formatPercentValue(coverageRatio * 100);
                  const coverageTone = getCoverageTone(coverageRatio);
                  return (
                    <tr
                      key={
                        statsDimension === 'host'
                          ? (item as HostUsageStats).hostId
                          : `${(item as GpuUsageStats).hostId}-${(item as GpuUsageStats).gpuIndex}`
                      }
                      className={classNames(
                        'border-t',
                        themed('border-slate-100 text-slate-800', 'border-slate-800 text-slate-200'),
                      )}
                    >
                      <td className="py-2 pr-4">
                        {statsDimension === 'host' ? (
                          <>
                            <p
                              className={classNames(
                                'font-semibold',
                                themed('text-slate-900', 'text-slate-100'),
                              )}
                            >
                              {(item as HostUsageStats).label ??
                                (item as HostUsageStats).hostId}
                            </p>
                            <p
                              className={classNames(
                                'text-xs',
                                themed('text-slate-500', 'text-slate-400'),
                              )}
                            >
                              {(item as HostUsageStats).hostId}
                            </p>
                          </>
                        ) : (
                          <p
                            className={classNames(
                              'font-semibold',
                              themed('text-slate-900', 'text-slate-100'),
                            )}
                          >
                            {(item as GpuUsageStats).hostId} · GPU{' '}
                            {(item as GpuUsageStats).gpuIndex}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {statsDimension === 'host' ? (
                          <span
                            className={classNames(
                              'font-semibold',
                              themed('text-slate-900', 'text-slate-100'),
                            )}
                          >
                            {(item as HostUsageStats).gpuCount}
                          </span>
                        ) : (
                          <span className={classNames(themed('text-slate-600', 'text-slate-400'))}>
                            {(item as GpuUsageStats).gpuName ?? '未知'}
                          </span>
                        )}
                      </td>
                      <td
                        className={classNames(
                          'py-2 pr-4 font-mono',
                          themed('text-slate-900', 'text-slate-100'),
                        )}
                      >
                        {usageHours}
                      </td>
                      <td
                        className={classNames(
                          'py-2 pr-4 font-semibold',
                          themed('text-slate-900', 'text-slate-100'),
                        )}
                      >
                        {usageRatio}
                      </td>
                      <td
                        className={classNames(
                          'py-2 pr-4',
                          themed('text-slate-900', 'text-slate-100'),
                        )}
                      >
                        {averageUtil}
                      </td>
                      <td
                        className={classNames(
                          'py-2 pr-4',
                          themed('text-slate-900', 'text-slate-100'),
                        )}
                      >
                        {averageMemory}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={classNames('font-semibold', coverageTone)}>
                          {coverageLabel}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p
            className={classNames(
              'mt-4 text-sm',
              themed('text-slate-500', 'text-slate-400'),
            )}
          >
            暂无统计数据，等待采样覆盖后自动填充。
          </p>
        )}
      </div>
    </div>
  );

  const settingsView = (
    <div className="space-y-4">
      <div className={classNames('rounded-2xl border p-4 shadow-sm', primaryCardClass)}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              添加主机
            </h2>
            <p className="text-sm text-slate-500">
              通过 SSH 连接测试与新增，无需修改 .env。
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={handleTestHost}
              disabled={hostTesting}
              className="rounded-full border border-slate-300 px-3 py-1 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {hostTesting ? '测试中…' : '连接测试'}
            </button>
            <button
              type="button"
              onClick={handleAddHost}
              disabled={hostAdding}
              className="rounded-full bg-slate-900 px-3 py-1 font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {hostAdding ? '添加中…' : '添加主机'}
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <input
            type="text"
            placeholder="主机 ID"
            value={hostForm.id}
            onChange={(event) =>
              setHostForm((prev) => ({ ...prev, id: event.target.value }))
            }
            className={inputClass}
          />
          <input
            type="text"
            placeholder="显示名称"
            value={hostForm.label}
            onChange={(event) =>
              setHostForm((prev) => ({ ...prev, label: event.target.value }))
            }
            className={inputClass}
          />
        </div>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <input
            type="text"
            placeholder="Host"
            value={hostForm.host}
            onChange={(event) =>
              setHostForm((prev) => ({ ...prev, host: event.target.value }))
            }
            className={inputClass}
          />
          <input
            type="text"
            placeholder="用户名"
            value={hostForm.username}
            onChange={(event) =>
              setHostForm((prev) => ({
                ...prev,
                username: event.target.value,
              }))
            }
            className={inputClass}
          />
          <input
            type="number"
            placeholder="端口"
            value={hostForm.port}
            onChange={(event) =>
              setHostForm((prev) => ({ ...prev, port: event.target.value }))
            }
            className={inputClass}
          />
          <input
            type="text"
            placeholder="私钥路径（可选）"
            value={hostForm.privateKeyPath}
            onChange={(event) =>
              setHostForm((prev) => ({
                ...prev,
                privateKeyPath: event.target.value,
              }))
            }
            className={inputClass}
          />
        </div>
        {hostTestStatus && (
          <p
            className={classNames(
              'mt-3 text-sm',
              hostTestStatus.type === 'success'
                ? 'text-emerald-600'
                : 'text-rose-600',
            )}
          >
            {hostTestStatus.text}
          </p>
        )}
        {hostAddStatus && (
          <p
            className={classNames(
              'mt-1 text-sm',
              hostAddStatus.type === 'success'
                ? 'text-emerald-600'
                : 'text-rose-600',
            )}
          >
            {hostAddStatus.text}
          </p>
        )}
      </div>
      <div className={classNames('rounded-2xl border p-4 shadow-sm', primaryCardClass)}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Telegram 设置
            </h2>
            <p className="text-sm text-slate-500">
              Token 不会在界面回显，请重新输入后保存。
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={handleSendTelegramTest}
              className="rounded-full border border-slate-300 px-3 py-1 text-slate-600 hover:bg-slate-100"
            >
              发送测试
            </button>
            <button
              type="button"
              onClick={handleSaveTelegramSettings}
              className="rounded-full bg-slate-900 px-3 py-1 font-semibold text-white hover:bg-slate-800"
            >
              保存
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <input
            type="text"
            placeholder="Bot Token"
            value={telegramForm.botToken}
            onChange={(event) =>
              setTelegramForm((prev) => ({
                ...prev,
                botToken: event.target.value,
              }))
            }
            className={inputClass}
          />
          <input
            type="text"
            placeholder="Chat ID"
            value={telegramForm.chatId}
            onChange={(event) =>
              setTelegramForm((prev) => ({
                ...prev,
                chatId: event.target.value,
              }))
            }
            className={inputClass}
          />
          <textarea
            value={telegramForm.message}
            onChange={(event) =>
              setTelegramForm((prev) => ({
                ...prev,
                message: event.target.value,
              }))
            }
            rows={2}
            className={classNames('md:col-span-2', inputClass)}
          />
          <label
            className={classNames(
              'flex items-center gap-2 text-sm',
              themed('text-slate-600', 'text-slate-300'),
            )}
          >
            <input
              type="checkbox"
              checked={telegramForm.disableNotifications}
              onChange={(event) =>
                setTelegramForm((prev) => ({
                  ...prev,
                  disableNotifications: event.target.checked,
                }))
              }
            />
            暂停告警推送
          </label>
        </div>
        {telegramStatus && (
          <p
            className={classNames(
              'mt-3 text-sm',
              telegramStatus.type === 'success'
                ? 'text-emerald-600'
                : 'text-rose-600',
            )}
          >
            {telegramStatus.text}
          </p>
        )}
      </div>
      <div className={classNames('rounded-3xl border p-6 shadow-sm', primaryCardClass)}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              采集参数
            </h2>
            <p className="text-sm text-slate-500">
              调整轮询周期、空闲判定与曲线窗口。
            </p>
          </div>
          <button
            type="button"
            onClick={handleSaveCollector}
            className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800"
          >
            保存
          </button>
        </div>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">轮询间隔 (毫秒)</span>
          <input
            type="number"
            min={5000}
            value={collectorForm.pollIntervalMs}
            onChange={(event) =>
              setCollectorForm((prev) => ({
                ...prev,
                pollIntervalMs: Number(event.target.value),
              }))
            }
            className={inputClass}
          />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">空闲窗口次数</span>
            <input
              type="number"
              min={1}
              value={collectorForm.idleWindow}
              onChange={(event) =>
                setCollectorForm((prev) => ({
                  ...prev,
                  idleWindow: Number(event.target.value),
                }))
              }
            className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">显存占比阈值</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={collectorForm.idleThreshold}
              onChange={(event) =>
                setCollectorForm((prev) => ({
                  ...prev,
                  idleThreshold: Number(event.target.value),
                }))
              }
            className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">曲线窗口 (小时)</span>
            <input
              type="number"
              min={1}
              max={168}
              value={collectorForm.chartWindowHours}
              onChange={(event) =>
                setCollectorForm((prev) => ({
                  ...prev,
                  chartWindowHours: Number(event.target.value),
                }))
              }
            className={inputClass}
            />
          </label>
        </div>
        {collectorStatus && (
          <p
            className={classNames(
              'mt-3 text-sm',
              collectorStatus.type === 'success'
                ? 'text-emerald-600'
                : 'text-rose-600',
            )}
          >
            {collectorStatus.text}
          </p>
        )}
      </div>
    </div>
  );

  const mainContent =
    activeView === 'home'
      ? homeView
      : activeView === 'gpus'
      ? gpuView
      : activeView === 'hosts'
      ? hostsView
      : activeView === 'stats'
      ? statsView
      : activeView === 'timeline'
      ? timelineView
      : settingsView;

  return (
    <>
      <div
        className={classNames(
          'flex h-[calc(100vh-32px)] flex-col gap-4 overflow-hidden rounded-2xl p-3 text-sm sm:p-4 lg:flex-row',
          themed(
            'bg-[radial-gradient(circle_at_top,_#e0f2ff,_#fdf4ff)] text-slate-900',
            'bg-gradient-to-br from-[#030712] via-[#020617] to-[#0b1120] text-slate-100',
          ),
        )}
      >
        {sidebar}
        <section
          className={classNames(
            'flex-1 h-full overflow-y-auto rounded-2xl p-4 shadow-lg shadow-slate-200/60',
            themed('bg-white', 'bg-slate-900/80'),
          )}
        >
          {mainContent}
        </section>
      </div>
      {processModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4">
          <div
            className={classNames(
              'max-w-lg flex-1 rounded-3xl p-6 shadow-2xl',
              themed('bg-white text-slate-900', 'bg-slate-900 text-slate-100'),
            )}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                进程详情 #{processModal.process.pid}
              </h3>
              <button
                type="button"
                onClick={() => setProcessModal(null)}
                className={classNames(
                  'rounded-full border px-3 py-1 text-sm',
                  themed(
                    'border-slate-200 text-slate-600 hover:bg-slate-100',
                    'border-slate-700 text-slate-200 hover:bg-slate-800',
                  ),
                )}
              >
                关闭
              </button>
            </div>
            <p className={classNames('mt-2 text-sm', themed('text-slate-500', 'text-slate-400'))}>
              {processModal.gpu.hostId} · GPU {processModal.gpu.gpuIndex} ·{' '}
              {processModal.gpu.gpuName}
            </p>
            <div className="mt-4 space-y-3 text-sm">
              <div>
                <p className="text-xs uppercase text-slate-400">命令行</p>
                <pre
                  className={classNames(
                    'mt-1 rounded-xl border p-3 text-xs whitespace-pre-wrap break-all',
                    themed('border-slate-200 bg-slate-50 text-slate-800', 'border-slate-700 bg-slate-900 text-slate-100'),
                  )}
                >
                  {processModal.process.command ?? processModal.process.name}
                </pre>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div
                  className={classNames(
                    'rounded-2xl border p-3',
                    themed('border-slate-200', 'border-slate-700'),
                  )}
                >
                  <p className="text-xs uppercase text-slate-400">执行者</p>
                  <p className="mt-1 font-semibold">
                    {processModal.process.ownerHint ??
                      processModal.process.hostUser ??
                      processModal.process.username ??
                      '未知'}
                  </p>
                  {processModal.process.containerName && (
                    <p className="text-xs text-slate-500">
                      容器：{processModal.process.containerName}
                    </p>
                  )}
                  {processModal.process.containerId &&
                    !processModal.process.containerName && (
                      <p className="text-xs text-slate-500">
                        容器：{processModal.process.containerId}
                      </p>
                    )}
                </div>
                <div
                  className={classNames(
                    'rounded-2xl border p-3',
                    themed('border-slate-200', 'border-slate-700'),
                  )}
                >
                  <p className="text-xs uppercase text-slate-400">宿主用户</p>
                  <p className="mt-1 font-semibold">
                    {processModal.process.hostUser ?? 'Unknown'}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div
                  className={classNames(
                    'rounded-2xl border p-3',
                    themed('border-slate-200', 'border-slate-700'),
                  )}
                >
                  <p className="text-xs uppercase text-slate-400">用户</p>
                  <p className="mt-1 font-semibold">
                    {processModal.process.username ?? '未知'}
                  </p>
                </div>
                <div
                  className={classNames(
                    'rounded-2xl border p-3',
                    themed('border-slate-200', 'border-slate-700'),
                  )}
                >
                  <p className="text-xs uppercase text-slate-400">显存</p>
                  <p className="mt-1 font-mono">
                    {processModal.process.memoryUsedMb} MiB
                  </p>
                </div>
                <div
                  className={classNames(
                    'rounded-2xl border p-3',
                    themed('border-slate-200', 'border-slate-700'),
                  )}
                >
                  <p className="text-xs uppercase text-slate-400">启动时间</p>
                  <p className="mt-1">
                    {processModal.process.startedAt
                      ? formatDateTime(processModal.process.startedAt)
                      : '未知'}
                  </p>
                </div>
                <div
                  className={classNames(
                    'rounded-2xl border p-3',
                    themed('border-slate-200', 'border-slate-700'),
                  )}
                >
                  <p className="text-xs uppercase text-slate-400">运行时长</p>
                  <p className="mt-1">
                    {processModal.process.startedAt
                      ? formatDuration(now - processModal.process.startedAt)
                      : 'N/A'}
                  </p>
                </div>
              </div>
              {processModal.process.parent && (
                <div
                  className={classNames(
                    'rounded-2xl border p-4',
                    themed(
                      'border-slate-200 bg-slate-50',
                      'border-slate-700 bg-slate-900',
                    ),
                  )}
                >
                  <p className="text-xs uppercase text-slate-400">
                    父进程 #{processModal.process.parent.pid}
                  </p>
                  <p className="mt-1 font-semibold">
                    {processModal.process.parent.command ?? '命令未知'}
                  </p>
                  <p className="text-xs text-slate-500">
                    用户：{processModal.process.parent.username ?? '未知'} · 启动：
                    {processModal.process.parent.startedAt
                      ? formatDateTime(processModal.process.parent.startedAt)
                      : '未知'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
