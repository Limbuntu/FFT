import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock3,
  CloudUpload,
  Cpu,
  Download,
  FileSearch,
  FileDown,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Gauge,
  Github,
  HardDrive,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Moon,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Square,
  Sun,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import './styles.css';

type Tab = 'console' | 'online' | 'transcode' | 'files' | 'benchmark' | 'presets' | 'system';
type BenchView = 'leaderboard' | 'test' | 'history';
type Theme = 'light' | 'dark';

type EncoderInfo = {
  name: string;
  label: string;
  available: boolean;
  hw_type: string;
};

type HardwareReport = {
  encoders: EncoderInfo[];
  ffmpeg_version: string;
};

type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
};

type FileBrowser = {
  current: string;
  parent: string | null;
  entries: FileEntry[];
};

type WatchFolder = {
  path: string;
  label: string;
  file_count: number;
  total_size: number;
  output_dest: string;
  output_dir: string;
  copy_av1: boolean;
  preset_name: string;
};

type WatchFolderPatch = Partial<Pick<WatchFolder, 'label' | 'output_dest' | 'output_dir' | 'copy_av1' | 'preset_name'>>;

type WatchFolderResult = {
  folder: WatchFolder;
  files: FileEntry[];
};

type ManagedFileMeta = {
  video_codec: string;
  audio_codec: string;
  channels: number;
  resolution: string;
  bitrate: number;
  frame_count: number;
  frame_rate: string;
  bit_depth: number;
  probe_failed: boolean;
};

type ManagedFileSide = {
  name: string;
  path: string;
  relative_dir: string;
  relative_path: string;
  size: number;
  exists: boolean;
  meta: ManagedFileMeta;
};

type ManagedFileItem = {
  id: string;
  status: ManagedStatus;
  source: ManagedFileSide;
  target: ManagedFileSide;
  message: string;
};

type ManagedFolderSummary = {
  name: string;
  source: string;
  target: string;
  file_count: number;
  source_size: number;
  target_size: number;
  created_at: string | null;
  finished_at: string | null;
  duration_sec: number;
  progress: number;
  active_task_id: string;
};

type ManagedFolderResponse = {
  folder: WatchFolder;
  summary: ManagedFolderSummary;
  items: ManagedFileItem[];
};

type ManagedStatus = 'keep' | 'add' | 'force' | 'running';

type TranscodeForm = {
  encoder: string;
  crf: number;
  preset: number | string;
  prefix: string;
  prefix_enabled: boolean;
  suffix: string;
  suffix_enabled: boolean;
  output_ext: string;
  auto_mp4: boolean;
  extra_args: string[];
};

type TaskRequest = {
  files?: string[];
  encoder?: string;
  crf?: number;
  preset?: number | string;
  extra_args?: string[];
  output_dir?: string;
  output_dest?: string;
  prefix?: string;
  prefix_enabled?: boolean;
  suffix?: string;
  suffix_enabled?: boolean;
  output_ext?: string;
  auto_mp4?: boolean;
  file_outputs?: Record<string, Record<string, string>>;
};

type TaskInfo = {
  task_id: string;
  request?: TaskRequest;
  status: string;
  progress: number;
  speed: string;
  eta: string;
  eta_seconds: number;
  current_file: string;
  current_file_progress: number;
  current_index: number;
  total_files: number;
  message: string;
  output_path: string;
  created_at: string;
  finished_at?: string;
  duration_sec?: number;
  results?: {
    input_path: string;
    output_path: string;
    original_size: number;
    output_size: number;
    duration_sec: number;
  }[];
};

type BenchmarkResult = {
  encoder: string;
  label: string;
  fps: number;
  elapsed: number;
  output_size: number;
  score: number;
  error: string;
};

type BenchmarkHistory = {
  results: BenchmarkResult[];
  timestamp: string | null;
};

type LeaderboardItem = {
  chip: string;
  encoder: string;
  score: number;
  note: string;
  isMe?: boolean;
};

type Preset = {
  name: string;
  encoder: string;
  crf: number;
  preset: number | string;
  extra_args: string[];
  builtin: boolean;
  output_ext: string;
};

type SystemInfo = {
  os: string;
  cpu: string;
  cores: number;
  threads: number;
  memory: string;
  gpu: string;
};

type SystemUsage = {
  cpu_percent: number;
  cpu_available: boolean;
  memory_percent: number;
  memory_available: boolean;
  memory_used: string;
  memory_total: string;
  gpu_percent: number;
  gpu_available: boolean;
  gpu_name: string;
  gpu_message: string;
  sampled_at: string;
};

type Toast = {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
};

type OnlineJob = {
  id: string;
  name: string;
  size: number;
  task_id?: string;
  download_url?: string;
  status: string;
  progress: number;
  message: string;
};

const emptyBrowser: FileBrowser = { current: '/', parent: null, entries: [] };
const defaultForm: TranscodeForm = { encoder: 'libsvtav1', crf: 28, preset: 8, prefix: '', prefix_enabled: false, suffix: '_av1', suffix_enabled: true, output_ext: 'auto', auto_mp4: true, extra_args: [] };
const feedbackURL = 'https://feedback-prod-d4gl0lj03892e606a-1251838363.tcloudbaseapp.com/feedback.html';
const incompatibleAV1OutputExts = new Set(['.mov', '.avi', '.wmv', '.flv', '.ts', '.mpg', '.mpeg']);
const qsvPresetLabels = ['veryslow', 'slower', 'slow', 'medium', 'fast', 'faster', 'veryfast', 'ultrafast'];
const presetVendorFilters: { value: PresetVendorFilter; label: string }[] = [
  { value: 'cpu', label: 'CPU' },
  { value: 'nvidia', label: 'NVIDIA' },
  { value: 'intel', label: 'INTEL' },
  { value: 'amd', label: 'AMD' },
];
const watchFolderScanIntervalMs = 60_000;
const completedFlashMs = 5_000;
const navItems: { id: Tab; label: string; description: string; icon: typeof Activity }[] = [
  { id: 'console', label: '控制台', description: '查看处理概览和运行状态', icon: LayoutDashboard },
  { id: 'online', label: '在线调用', description: '拖拽上传文件并在浏览器下载转码结果', icon: CloudUpload },
  { id: 'transcode', label: '转码', description: '监控目录、选择文件并管理转码任务', icon: FileVideo },
  { id: 'files', label: '文件管理', description: '对比源文件和目标 AV1 文件', icon: FileSearch },
  { id: 'benchmark', label: '跑分', description: '测试编码器性能并查看本机记录', icon: BarChart3 },
  { id: 'presets', label: '预设', description: '维护常用编码参数和输出格式', icon: Save },
  { id: 'system', label: '系统信息', description: '查看硬件信息和支持的转码方式', icon: Cpu },
];

function App() {
  const [tab, setTab] = useLocalStorage<Tab>('fft_active_tab', 'console');
  const [theme, setTheme] = useLocalStorage<Theme>('fft_theme', 'light');
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage('fft_sidebar_collapsed', false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const [watchFolders, setWatchFolders] = useState<WatchFolderResult[]>([]);
  const [wfLoading, setWfLoading] = useState(false);
  const [managedFolderPath, setManagedFolderPath] = useLocalStorage('fft_managed_folder_path', '');
  const [managedData, setManagedData] = useState<ManagedFolderResponse | null>(null);
  const [managedLoading, setManagedLoading] = useState(false);
  const [managedActions, setManagedActions] = useState<ManagedStatus[]>(['keep', 'add', 'force']);
  const [managedOverrides, setManagedOverrides] = useState<Record<string, ManagedStatus>>({});
  const [autoTranscode, setAutoTranscode] = useLocalStorage('fft_auto_transcode_enabled', false);
  const [fileBrowser, setFileBrowser] = useState<FileBrowser>(emptyBrowser);
  const [browserMode, setBrowserMode] = useState<'watch' | 'replace' | 'output' | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderBusy, setNewFolderBusy] = useState(false);
  const outputFolderRef = useRef<string>('');
  const replacingFolderRef = useRef<string>('');
  const knownFilePaths = useRef<Set<string>>(new Set());

  const [hardware, setHardware] = useState<HardwareReport>({ encoders: [], ffmpeg_version: '' });
  const [hwLoading, setHwLoading] = useState(false);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [onlineJobs, setOnlineJobs] = useLocalStorage<OnlineJob[]>('fft_online_jobs', []);
  const [form, setForm] = useLocalStorage<TranscodeForm>('fft_transcode_form', defaultForm);
  const [selectedPreset, setSelectedPreset] = useLocalStorage('fft_last_preset', '');

  const [benchResults, setBenchResults] = useState<BenchmarkResult[]>([]);
  const [benchLoading, setBenchLoading] = useState(false);
  const [benchEncoders, setBenchEncoders] = useState<string[]>([]);
  const [benchRoundInfo, setBenchRoundInfo] = useState('');
  const [benchView, setBenchView] = useState<BenchView>('leaderboard');
  const [benchHistory, setBenchHistory] = useState<BenchmarkHistory | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [lbEncoder, setLbEncoder] = useState('');
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [systemUsage, setSystemUsage] = useState<SystemUsage | null>(null);

  const [presets, setPresets] = useState<Preset[]>([]);
  const [editingPreset, setEditingPreset] = useState<string | null>(null);
  const [editPreset, setEditPreset] = useState({ encoder: 'libsvtav1', crf: 28, preset: 8 as number | string, extra_args: '' });
  const [newPreset, setNewPreset] = useState({ name: '', encoder: 'libsvtav1', crf: 28, preset: 8 as number | string, extra_args: '', output_ext: 'auto' });

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastSeq.current;
    setToasts((items) => [...items, { id, message, type }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 5000);
  }, []);

  const availableEncoders = useMemo(() => hardware.encoders.filter((encoder) => encoder.available), [hardware.encoders]);
  const availableEncoderNames = useMemo(() => new Set(availableEncoders.map((encoder) => encoder.name)), [availableEncoders]);
  const availablePresets = useMemo(() => presets.filter((preset) => availableEncoderNames.has(preset.encoder)), [availableEncoderNames, presets]);
  const browserFolders = useMemo(() => fileBrowser.entries.filter((entry) => entry.is_dir), [fileBrowser.entries]);
  const onlineTaskIds = useMemo(() => new Set(onlineJobs.map((job) => job.task_id).filter(Boolean) as string[]), [onlineJobs]);
  const onlineTasks = useMemo(() => tasks.filter((task) => onlineTaskIds.has(task.task_id)), [onlineTaskIds, tasks]);
  const managedFolder = useMemo(
    () => watchFolders.find((wf) => wf.folder.path === managedFolderPath)?.folder || managedData?.folder,
    [managedData?.folder, managedFolderPath, watchFolders],
  );
  const managedItems = useMemo(
    () => (managedData?.items || []).map((item) => ({
      ...item,
      status: managedOverrides[item.id] || item.status,
      target: previewManagedTarget(item, managedFolder, availablePresets, form),
    })),
    [availablePresets, form, managedData?.items, managedFolder, managedOverrides],
  );
  const managedFilteredItems = useMemo(
    () => managedItems.filter((item) => item.status === 'running' || managedActions.includes(item.status)),
    [managedActions, managedItems],
  );

  useEffect(() => {
    if (tab !== 'files' && Object.keys(managedOverrides).length) {
      setManagedOverrides({});
    }
  }, [managedOverrides, tab]);

  useEffect(() => {
    if (!navItems.some((item) => item.id === tab)) setTab('console');
  }, [setTab, tab]);

  useEffect(() => {
    setForm((old) => {
      const next = normalizedTranscodeForm(old);
      return JSON.stringify(next) === JSON.stringify(old) ? old : next;
    });
  }, [setForm]);

  const loadWatchFolders = useCallback(
    async (isInit = false, showLoading = true) => {
      if (showLoading) setWfLoading(true);
      try {
        const data = await apiGet<WatchFolderResult[]>('/api/watchfolders');
        setWatchFolders(data);
        const currentPaths = new Set(data.flatMap((wf) => wf.files.map((file) => file.path)));
        if (isInit) {
          knownFilePaths.current = currentPaths;
          return;
        }
        const newFiles = [...currentPaths].filter((path) => !knownFilePaths.current.has(path));
        if (newFiles.length) {
          showToast(`发现 ${newFiles.length} 个新文件`, 'info');
          if (autoTranscode) {
            void startTranscodeFor(newFiles);
          }
        }
        knownFilePaths.current = currentPaths;
      } catch (error) {
        showToast(errorMessage(error), 'error');
      } finally {
        if (showLoading) setWfLoading(false);
      }
    },
    [autoTranscode, showToast],
  );

  const detectHardware = useCallback(
    async (refresh = false) => {
      setHwLoading(true);
      try {
        const data = await apiGet<HardwareReport>(`/api/hardware?refresh=${refresh}`);
        setHardware(data);
        if (!form.encoder || !data.encoders.some((encoder) => encoder.name === form.encoder && encoder.available)) {
          const first = data.encoders.find((encoder) => encoder.available);
          if (first) setForm((old) => ({ ...old, encoder: first.name }));
        }
      } catch (error) {
        showToast(errorMessage(error), 'error');
      } finally {
        setHwLoading(false);
      }
    },
    [form.encoder, setForm, showToast],
  );

  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await apiGet<TaskInfo[]>('/api/tasks'));
    } catch (error) {
      showToast(errorMessage(error), 'error');
    }
  }, [showToast]);

  const loadManagedFolder = useCallback(async (path: string) => {
    if (!path) {
      setManagedData(null);
      return;
    }
    setManagedLoading(true);
    try {
      const params = new URLSearchParams({
        prefix: form.prefix_enabled === true ? form.prefix || '' : '',
        prefix_enabled: String(form.prefix_enabled === true),
        suffix: form.suffix_enabled !== false ? form.suffix || '_av1' : '',
        suffix_enabled: String(form.suffix_enabled !== false),
        output_ext: form.output_ext || 'auto',
        auto_mp4: String(form.auto_mp4 !== false),
      });
      setManagedData(await apiGet<ManagedFolderResponse>(`/api/watchfolders/${pathToB64(path)}/manage?${params.toString()}`));
      setManagedOverrides({});
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally {
      setManagedLoading(false);
    }
  }, [form.auto_mp4, form.output_ext, form.prefix, form.prefix_enabled, form.suffix, form.suffix_enabled, showToast]);

  const loadPresets = useCallback(async () => {
    try {
      setPresets(await apiGet<Preset[]>('/api/presets'));
    } catch (error) {
      showToast(errorMessage(error), 'error');
    }
  }, [showToast]);

  const loadBenchHistory = useCallback(async () => {
    try {
      const data = await apiGet<BenchmarkHistory>('/api/benchmark/history');
      if (data.results?.length) setBenchHistory(data);
    } catch (error) {
      showToast(errorMessage(error), 'error');
    }
  }, [showToast]);

  const loadSystemUsage = useCallback(async () => {
    try {
      setSystemUsage(await apiGet<SystemUsage>('/api/system/usage'));
    } catch {
      setSystemUsage(null);
    }
  }, []);

  useEffect(() => {
    void loadWatchFolders(true);
    void detectHardware(false);
    void refreshTasks();
    void loadPresets();
    void loadBenchHistory();
    void loadSystemUsage();
    void apiGet<SystemInfo>('/api/sysinfo').then(setSysInfo).catch(() => undefined);
    void apiGet<LeaderboardItem[]>('/api/leaderboard').then((rows) => setLeaderboard(rows.sort((a, b) => b.score - a.score))).catch(() => undefined);
  }, [detectHardware, loadBenchHistory, loadPresets, loadSystemUsage, loadWatchFolders, refreshTasks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadSystemUsage();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadSystemUsage]);

  useEffect(() => {
    if (!managedFolderPath && watchFolders.length) {
      setManagedFolderPath(watchFolders[0].folder.path);
      return;
    }
    if (managedFolderPath && !watchFolders.some((wf) => wf.folder.path === managedFolderPath)) {
      setManagedFolderPath(watchFolders[0]?.folder.path || '');
    }
  }, [managedFolderPath, setManagedFolderPath, watchFolders]);

  useEffect(() => {
    if (tab === 'files') void loadManagedFolder(managedFolderPath);
  }, [loadManagedFolder, managedFolderPath, tab, tasks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (watchFolders.length) void loadWatchFolders(false, false);
    }, watchFolderScanIntervalMs);
    return () => window.clearInterval(timer);
  }, [loadWatchFolders, watchFolders.length]);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let closed = false;
    let socket: WebSocket;
    const connect = () => {
      socket = new WebSocket(`${proto}://${window.location.host}/ws`);
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'toast') {
          showToast(msg.message, msg.level || 'info');
          return;
        }
        if (msg.type === 'bench_progress') {
          setBenchRoundInfo(`${msg.encoder} 编码中 ${msg.progress}%${msg.speed ? ` (${msg.speed})` : ''}`);
          return;
        }
        if (msg.type === 'bench_round') {
          setBenchRoundInfo(`${msg.encoder} 第 ${msg.round}/${msg.total_rounds} 轮完成 (${msg.fps} fps)`);
          return;
        }
        if (msg.type === 'bench_result') {
          setBenchResults((items) => [...items.filter((item) => item.encoder !== msg.result.encoder), msg.result]);
          setBenchRoundInfo('');
          return;
        }
        if (msg.type === 'bench_done') {
          setBenchLoading(false);
          setBenchRoundInfo('');
          if (msg.message) showToast(msg.message, 'info');
          void loadBenchHistory();
          return;
        }
        if (msg.task_id) {
          setOnlineJobs((jobs) => jobs.map((job) => job.task_id === msg.task_id ? {
            ...job,
            status: msg.status || job.status,
            progress: msg.progress ?? job.progress,
            message: msg.message || msg.current_file || job.message,
          } : job));
          setTasks((items) => {
            const old = items.find((item) => item.task_id === msg.task_id);
            if (old?.status !== 'done' && msg.status === 'done') showToast(`转码完成: ${msg.current_file || msg.task_id}`, 'success');
            if (old?.status !== 'failed' && msg.status === 'failed') showToast(`转码失败: ${msg.message || msg.task_id}`, 'error');
            const next = items.some((item) => item.task_id === msg.task_id)
              ? items.map((item) => (item.task_id === msg.task_id ? { ...item, ...msg } : item))
              : [{ ...msg }, ...items];
            return next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          });
        }
      };
      socket.onclose = () => {
        if (!closed) window.setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      socket?.close();
    };
  }, [loadBenchHistory, showToast]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!selectedPreset) return;
    if (!availablePresets.some((preset) => preset.name === selectedPreset)) {
      setSelectedPreset('');
    }
  }, [availablePresets, selectedPreset, setSelectedPreset]);

  async function browseTo(path: string) {
    setFileBrowser(await apiGet<FileBrowser>(`/api/files?path=${encodeURIComponent(path)}`));
    setNewFolderOpen(false);
    setNewFolderName('');
  }

  async function browseToPreferred(path: string, fallback = '/') {
    try {
      await browseTo(path || fallback);
    } catch (error) {
      if (fallback && fallback !== path) {
        await browseTo(fallback);
        return;
      }
      showToast(errorMessage(error), 'error');
    }
  }

  function outputFolderBrowseStart(path: string) {
    const wf = watchFolders.find((item) => item.folder.path === path);
    if (!wf) return path || '/';
    const outputDest = normalizedOutputDest(wf.folder);
    if (outputDest === 'custom' && wf.folder.output_dir) return wf.folder.output_dir;
    if (outputDest === 'subfolder') return joinPath(wf.folder.path, 'AV1');
    return wf.folder.path;
  }

  function openWatchFolderBrowser() {
    setBrowserMode('watch');
    void browseToPreferred('/');
  }

  function openReplaceWatchFolderBrowser(path: string) {
    replacingFolderRef.current = path;
    setBrowserMode('replace');
    void browseToPreferred(path, '/');
  }

  function openOutputFolderBrowser(path: string) {
    outputFolderRef.current = path;
    setBrowserMode('output');
    void browseToPreferred(outputFolderBrowseStart(path), path || '/');
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setNewFolderBusy(true);
    try {
      const result = await apiSend<{ path: string }>('/api/files/folder', { parent: fileBrowser.current, name });
      showToast(`已创建文件夹: ${name}`, 'success');
      await browseTo(result.path);
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally {
      setNewFolderBusy(false);
    }
  }

  async function addWatchFolder(path: string) {
    if (!path) return;
    await apiSend('/api/watchfolders', { path });
    await loadWatchFolders(false);
  }

  async function removeWatchFolder(path: string) {
    await apiSend(`/api/watchfolders/${pathToB64(path)}`, undefined, 'DELETE');
    await loadWatchFolders(false);
  }

  async function updateFolder(folderPath: string, patch: WatchFolderPatch) {
    await apiSend(`/api/watchfolders/${pathToB64(folderPath)}`, patch, 'PATCH');
    setWatchFolders((items) =>
      items.map((wf) => (wf.folder.path === folderPath ? { ...wf, folder: { ...wf.folder, ...patch } } : wf)),
    );
    if (folderPath === managedFolderPath) {
      setManagedData((old) => old ? {
        ...old,
        folder: { ...old.folder, ...patch },
        items: patch.copy_av1 === undefined
          ? old.items
          : old.items.map((item) => reclassifyManagedAV1Item(item, patch.copy_av1 ?? old.folder.copy_av1)),
      } : old);
      if (patch.copy_av1 !== undefined) setManagedOverrides({});
    }
  }

  async function chooseOutputFolder(selectedPath: string) {
    const sourcePath = outputFolderRef.current;
    if (!sourcePath) return;
    const patch: WatchFolderPatch = sameFolderPath(selectedPath, sourcePath)
      ? { output_dest: 'beside', output_dir: '' }
      : { output_dest: 'custom', output_dir: selectedPath };
    await updateFolder(sourcePath, patch);
  }

  async function replaceWatchFolder(oldPath: string, newPath: string) {
    if (!oldPath || !newPath) return;
    await apiSend(`/api/watchfolders/${pathToB64(oldPath)}`, { path: newPath }, 'PATCH');
    const data = await apiGet<WatchFolderResult[]>('/api/watchfolders');
    setWatchFolders(data);
    const currentPaths = new Set(data.flatMap((wf) => wf.files.map((file) => file.path)));
    knownFilePaths.current = currentPaths;
  }

  function watchFolderForFile(file: string) {
    return watchFolders.find((item) => fileBelongsToWatchFolder(file, item));
  }

  function buildFileOutputs(files: string[]) {
    const map: Record<string, { output_dest: string; output_dir: string; prefix?: string; suffix?: string; copy_av1?: string }> = {};
    const basePrefix = form.prefix_enabled === true ? form.prefix || '' : '';
    const baseSuffix = form.suffix_enabled !== false ? form.suffix || '_av1' : '';
    for (const file of files) {
      const wf = watchFolderForFile(file);
      if (wf) {
        const outputDest = normalizedOutputDest(wf.folder);
        if (!outputDest) continue;
        const isAV1Source = managedData?.items.some((item) => item.source.path === file && isAV1CodecName(item.source.meta?.video_codec));
        const copyAV1 = wf.folder.copy_av1 !== false && isAV1Source;
        const suffix = copyAV1
          ? ''
          : outputDest === 'subfolder' || outputDest === 'custom'
            ? flattenedOutputSuffix(wf.folder.path, file, baseSuffix)
            : baseSuffix;
        map[file] = {
          output_dest: outputDest === 'subfolder' ? 'custom' : outputDest,
          output_dir: outputDest === 'subfolder' ? joinPath(wf.folder.path, 'AV1') : wf.folder.output_dir || '',
          prefix: copyAV1 ? '' : basePrefix,
          suffix,
          copy_av1: wf.folder.copy_av1 !== false ? 'true' : 'false',
        };
      }
    }
    return map;
  }

  async function startTranscodeFor(files: string[]) {
    const skipped = files.filter((file) => {
      const wf = watchFolderForFile(file);
      const outputDest = wf ? normalizedOutputDest(wf.folder) : '';
      return wf && (!outputDest || (outputDest === 'custom' && !wf.folder.output_dir));
    });
    const runnableFiles = files.filter((file) => !skipped.includes(file));
    if (skipped.length) {
      showToast(`已跳过 ${skipped.length} 个未设置输出位置的文件`, 'info');
    }
    if (!runnableFiles.length) {
      showToast('请先为目录监控设置输出方式', 'info');
      return;
    }
    const groups = groupFilesByTranscodeSettings(runnableFiles, watchFolders, availablePresets, form);
    for (const group of groups) {
      await apiSend('/api/transcode', {
        ...group.request,
        auto_mp4: form.auto_mp4 !== false,
        suffix_enabled: form.suffix_enabled !== false,
        files: group.files,
        file_outputs: buildFileOutputs(group.files),
      });
    }
    showToast(groups.length > 1 ? `已按目录预设提交 ${groups.length} 个转码任务` : `已提交 ${runnableFiles.length} 个文件转码`, 'info');
    await refreshTasks();
  }

  async function cancelTranscodeTask(taskID: string) {
    if (!taskID) return;
    try {
      await apiSend(`/api/transcode/${taskID}`, undefined, 'DELETE');
      showToast('已取消转码任务', 'info');
      await refreshTasks();
    } catch (error) {
      showToast(errorMessage(error), 'error');
    }
  }

  async function startManagedTranscode() {
    const files = managedFilteredItems
      .filter((item) => item.status === 'add' || item.status === 'force')
      .map((item) => item.source.path);
    if (!files.length) {
      showToast('当前选择下没有需要提交的文件', 'info');
      return;
    }
    await startTranscodeFor(files);
    await loadManagedFolder(managedFolderPath);
  }

  async function uploadOnlineFiles(files: File[]) {
    if (!files.length) return;
    const selectedOnlinePreset = availablePresets.find((preset) => preset.name === selectedPreset);
    if (!selectedOnlinePreset) {
      showToast('请先选择在线转码预设', 'error');
      return;
    }
    const extraArgs = form.extra_args || [];
    for (const file of files) {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setOnlineJobs((jobs) => [{ id, name: file.name, size: file.size, status: 'uploading', progress: 0, message: '上传中' }, ...jobs]);
      try {
        const body = new FormData();
        body.append('file', file);
        body.append('encoder', form.encoder);
        body.append('crf', String(form.crf));
        body.append('preset', String(form.preset));
        body.append('prefix', form.prefix_enabled === true ? form.prefix : '');
        body.append('prefix_enabled', String(form.prefix_enabled === true));
        body.append('suffix', form.suffix_enabled !== false ? form.suffix : '');
        body.append('suffix_enabled', String(form.suffix_enabled !== false));
        body.append('output_ext', form.output_ext);
        body.append('auto_mp4', String(form.auto_mp4 !== false));
        body.append('extra_args', extraArgs.join(' '));
        const result = await apiUpload<{ task_id: string; download_url: string }>('/api/online/transcode', body);
        setOnlineJobs((jobs) => jobs.map((job) => job.id === id ? {
          ...job,
          task_id: result.task_id,
          download_url: result.download_url,
          status: 'pending',
          message: '等待转码',
        } : job));
        showToast(`已提交在线转码: ${file.name}`, 'info');
        await refreshTasks();
      } catch (error) {
        setOnlineJobs((jobs) => jobs.map((job) => job.id === id ? { ...job, status: 'failed', message: errorMessage(error) } : job));
        showToast(errorMessage(error), 'error');
      }
    }
  }

  async function deleteOnlineJob(job: OnlineJob) {
    const task = job.task_id ? tasks.find((item) => item.task_id === job.task_id) : undefined;
    const status = task?.status || job.status;
    setOnlineJobs((jobs) => jobs.filter((item) => item.id !== job.id));
    if (job.task_id && (status === 'pending' || status === 'running')) {
      try {
        await apiSend(`/api/transcode/${job.task_id}`, undefined, 'DELETE');
        await refreshTasks();
      } catch (error) {
        showToast(errorMessage(error), 'error');
      }
    }
    showToast('已删除在线任务', 'success');
  }

  async function downloadTaskReport(taskID?: string) {
    if (!taskID) return;
    try {
      await downloadBlob(`/api/transcode/${taskID}/report.pdf`, `fft-report-${taskID}.pdf`, 'application/pdf');
      showToast('PDF 报告已开始下载', 'success');
    } catch (error) {
      showToast(errorMessage(error), 'error');
    }
  }

  async function runBenchmark() {
    setBenchLoading(true);
    setBenchResults([]);
    setBenchView('test');
    try {
      const result = await apiSend<{ status: string }>('/api/benchmark', benchEncoders.length ? { encoders: benchEncoders } : {});
      if (result.status === 'already_running') {
        showToast('跑分已在运行', 'info');
      }
      if (result.status !== 'started') setBenchLoading(false);
    } catch (error) {
      setBenchLoading(false);
      showToast(errorMessage(error), 'error');
    }
  }

  async function savePreset(preset: Preset | null = null) {
    const payload = preset ? normalizedPreset(preset) : normalizedPreset({ ...newPreset, extra_args: splitArgs(newPreset.extra_args), output_ext: newPreset.output_ext || 'auto', builtin: false });
    await apiSend('/api/presets', payload);
    setNewPreset({ name: '', encoder: form.encoder, crf: 28, preset: 8, extra_args: '', output_ext: 'auto' });
    setEditingPreset(null);
    await loadPresets();
  }

  const totalEta = useMemo(() => {
    const total = tasks.filter((task) => task.status === 'running' || task.status === 'pending').reduce((sum, task) => sum + (task.eta_seconds || 0), 0);
    return total > 0 ? `预计剩余 ${formatDuration(total)}` : '';
  }, [tasks]);

  const filteredLeaderboard = useMemo(() => {
    let rows = [...leaderboard];
    if (benchHistory?.results?.length) {
      rows = rows.concat(
        benchHistory.results
          .filter((result) => !result.error)
          .map((result) => ({
            chip: sysInfo?.cpu || '本机',
            encoder: result.encoder,
            score: result.score,
            note: '本机分数',
            isMe: true,
          })),
      );
    }
    if (lbEncoder) rows = rows.filter((row) => row.encoder === lbEncoder);
    return groupBy(rows, (row) => row.encoder)
      .map(([encoder, items]) => ({
        encoder,
        items: items.sort((a, b) => b.score - a.score),
      }))
      .sort((a, b) => compareEncoders(a.encoder, b.encoder));
  }, [benchHistory, lbEncoder, leaderboard, sysInfo]);

  const lbEncoders = useMemo(() => sortEncoders(Array.from(new Set([
    ...leaderboard.map((row) => row.encoder),
    ...(benchHistory?.results || []).filter((result) => !result.error).map((result) => result.encoder),
  ]))), [benchHistory, leaderboard]);

  useEffect(() => {
    if (lbEncoders.length && !lbEncoders.includes(lbEncoder)) setLbEncoder(lbEncoders[0]);
  }, [lbEncoder, lbEncoders]);

  const isDark = theme === 'dark';

  return (
    <div className="app-root">
      <div className="fixed right-4 top-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>{toast.message}</div>
        ))}
      </div>
      <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className="app-sidebar">
          <div className="sidebar-brand">
            <div className="brand-mark"><Activity size={19} /></div>
            <div className="sidebar-brand-text">
              <h1>FFT</h1>
              <p>FFmpeg AV1 Transcoder</p>
            </div>
          </div>

          <nav className="sidebar-nav" aria-label="主导航">
            <div className="sidebar-nav-label">导航</div>
            <button
              className="sidebar-nav-item sidebar-collapse-btn"
              type="button"
              aria-label={sidebarCollapsed ? '展开导航栏' : '折叠导航栏'}
              title={sidebarCollapsed ? '展开导航栏' : '折叠导航栏'}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              <span>
                <strong>{sidebarCollapsed ? '展开' : '折叠'}</strong>
              </span>
            </button>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={`sidebar-nav-item ${tab === item.id ? 'active' : ''}`} aria-label={item.label} title={sidebarCollapsed ? item.label : undefined} onClick={() => setTab(item.id)}>
                  <Icon size={18} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-footer-meta">
              <span className="sidebar-version">FFT v2.2.1</span>
              <button className="theme-toggle" aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'} title={isDark ? '浅色模式' : '深色模式'} onClick={() => setTheme(isDark ? 'light' : 'dark')}>
                {isDark ? <Sun size={14} /> : <Moon size={14} />}
              </button>
              <a className="sidebar-icon-link" href={feedbackURL} target="_blank" rel="noreferrer" title="提交反馈" aria-label="提交反馈"><MessageSquare size={14} /><span>反馈</span></a>
              <a className="sidebar-icon-link icon-only" href="https://github.com/Limbuntu/FFT" target="_blank" rel="noreferrer" title="GitHub" aria-label="GitHub"><Github size={14} /></a>
              <a className="sidebar-log-link" href="/api/logs/download" title="日志"><Download size={13} /><span>日志</span></a>
            </div>
          </div>
        </aside>

        <div className="app-content">
          <main className={`app-main ${tab === 'transcode' ? 'workspace-grid' : tab === 'console' || tab === 'online' || tab === 'system' || tab === 'files' ? 'workspace-console' : 'workspace-single'}`}>
            {tab === 'console' && (
              <ConsolePage
                watchFolders={watchFolders}
                tasks={tasks}
                presets={availablePresets}
                globalForm={form}
                sysInfo={sysInfo}
                systemUsage={systemUsage}
                onBrowseWatchFolder={openWatchFolderBrowser}
                onRefreshWatchFolders={() => void loadWatchFolders(false, true)}
                wfLoading={wfLoading}
                onRemoveWatchFolder={(path) => void removeWatchFolder(path)}
                onUpdateFolder={(path, patch) => updateFolder(path, patch)}
                onReplaceWatchFolder={openReplaceWatchFolderBrowser}
                onBrowseOutputFolder={openOutputFolderBrowser}
                onStartFolderTranscode={(files) => void startTranscodeFor(files)}
                onCancelTask={(taskID) => void cancelTranscodeTask(taskID)}
                autoTranscode={autoTranscode}
                onAutoTranscodeChange={setAutoTranscode}
              />
            )}

            {tab === 'online' && (
              <OnlinePage
                jobs={onlineJobs}
                tasks={onlineTasks}
                presets={availablePresets}
                selectedPreset={selectedPreset}
                onPresetChange={(name) => {
                  setSelectedPreset(name);
                  const preset = availablePresets.find((item) => item.name === name);
                  if (preset) setForm((old) => ({ ...old, ...presetToFormPatch(preset, old.output_ext) }));
                  else setForm((old) => ({ ...old, extra_args: [] }));
                }}
                onUpload={(files) => void uploadOnlineFiles(files)}
                onDeleteJob={(job) => void deleteOnlineJob(job)}
                onDownloadReport={downloadTaskReport}
              />
            )}

            {tab === 'system' && (
              <SystemPage sysInfo={sysInfo} tasks={tasks} hardware={hardware} hwLoading={hwLoading} onRefresh={() => void detectHardware(true)} />
            )}

            {tab === 'files' && (
              <FileManagerPage
                watchFolders={watchFolders}
                selectedPath={managedFolderPath}
                globalForm={form}
                data={managedData}
                loading={managedLoading}
                tasks={tasks}
                presets={availablePresets}
                actions={managedActions}
                items={managedItems}
                filteredItems={managedFilteredItems}
                onSelectFolder={(path) => {
                  setManagedFolderPath(path);
                  void loadManagedFolder(path);
                }}
                onUpdateFolder={(path, patch) => updateFolder(path, patch)}
                onBrowseOutputFolder={openOutputFolderBrowser}
                onRefresh={() => loadManagedFolder(managedFolderPath)}
                onStartFolderTranscode={(files) => void startTranscodeFor(files)}
                onToggleAction={(status) => setManagedActions((old) => old.includes(status) ? old.filter((item) => item !== status) : [...old, status])}
                onToggleItemStatus={(item) => setManagedOverrides((old) => ({ ...old, [item.id]: item.status === 'keep' ? 'add' : 'keep' }))}
                onToggleAllItems={(status) => {
                  setManagedOverrides(Object.fromEntries(
                    (managedData?.items || [])
                      .filter((item) => item.status !== 'running')
                      .map((item) => [item.id, status]),
                  ));
                }}
                onRunSelected={() => void startManagedTranscode()}
                onReport={() => {
                  const task = tasks.find((item) => item.request?.files?.some((file) => pathBelongsToFolder(file, managedFolderPath)) && item.status === 'done');
                  void downloadTaskReport(task?.task_id);
                }}
                onCancel={() => {
                  if (managedData?.summary.active_task_id) void apiSend(`/api/transcode/${managedData.summary.active_task_id}`, undefined, 'DELETE').then(refreshTasks);
                }}
                autoTranscode={autoTranscode}
                onAutoTranscodeChange={setAutoTranscode}
              />
            )}

            {tab === 'transcode' && (
              <>
                <section className="panel workspace-panel transcode-settings-panel">
                  <div className="transcode-settings-body">
                    <div className="section-title"><Gauge size={18} />全局转码设置</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="field">
                        <span>编码器</span>
                        <select value={form.encoder} onChange={(event) => {
                          const encoder = event.target.value;
                          setSelectedPreset('');
                          setForm((old) => ({ ...old, encoder, preset: encoder === 'av1_qsv' ? Math.min(Number(old.preset) || 4, 7) : old.preset, extra_args: [] }));
                        }}>
                          {availableEncoders.map((encoder) => <option key={encoder.name} value={encoder.name}>{encoder.label}</option>)}
                        </select>
                      </label>
                      <label className="field">
                        <span>预设</span>
                        <select value={selectedPreset} onChange={(event) => {
                          const name = event.target.value;
                          setSelectedPreset(name);
                          const preset = availablePresets.find((item) => item.name === name);
                          if (preset) setForm((old) => ({ ...old, ...presetToFormPatch(preset, old.output_ext) }));
                          else setForm((old) => ({ ...old, extra_args: [] }));
                        }}>
                          <option value="">自定义</option>
                          {availablePresets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
                        </select>
                      </label>
                    </div>
                    <RangeField label="CRF" value={Number(form.crf)} min={0} max={63} onChange={(value) => setForm((old) => ({ ...old, crf: value }))} />
                    <RangeField
                      label="Preset"
                      value={Number(form.preset)}
                      min={0}
                      max={form.encoder === 'av1_qsv' ? 7 : 13}
                      displayValue={presetDisplayValue(form.encoder, form.preset)}
                      onChange={(value) => setForm((old) => ({ ...old, preset: value }))}
                    />
	                    <div className="grid gap-3 lg:grid-cols-3">
	                      <label className="field">
	                        <span className="field-label-row">
	                          <span>输出前缀</span>
	                          <span className="mini-toggle" title={form.prefix_enabled === true ? '关闭输出前缀' : '开启输出前缀'}>
	                            <input
	                              className="mini-toggle-input"
	                              type="checkbox"
	                              checked={form.prefix_enabled === true}
	                              aria-label="开启输出前缀"
	                              onChange={(event) => setForm((old) => ({ ...old, prefix_enabled: event.target.checked }))}
	                            />
	                            <span className="mini-toggle-track" aria-hidden="true" />
	                          </span>
	                        </span>
	                        <input
	                          value={form.prefix}
	                          disabled={form.prefix_enabled !== true}
	                          placeholder="例如 av1_"
	                          onChange={(event) => setForm((old) => ({ ...old, prefix: event.target.value }))}
	                        />
	                      </label>
	                      <label className="field">
	                        <span className="field-label-row">
	                          <span>输出后缀</span>
	                          <span className="mini-toggle" title={form.suffix_enabled !== false ? '关闭输出后缀' : '开启输出后缀'}>
	                            <input
	                              className="mini-toggle-input"
	                              type="checkbox"
	                              checked={form.suffix_enabled !== false}
	                              aria-label="开启输出后缀"
	                              onChange={(event) => setForm((old) => ({ ...old, suffix_enabled: event.target.checked }))}
	                            />
	                            <span className="mini-toggle-track" aria-hidden="true" />
	                          </span>
	                        </span>
	                        <input
	                          value={form.suffix}
	                          disabled={form.suffix_enabled === false}
	                          onChange={(event) => setForm((old) => ({ ...old, suffix: event.target.value }))}
	                        />
	                      </label>
	                      <label className="field"><span>输出格式</span><select value={form.output_ext} onChange={(event) => setForm((old) => ({ ...old, output_ext: event.target.value }))}><option value="auto">自动</option><option value=".mkv">.mkv</option><option value=".mp4">.mp4</option><option value=".webm">.webm</option></select></label>
	                    </div>
                    <label className="toggle-card transcode-advanced-toggle">
                      <span>
                        <strong>容器不兼容时自动改为 MP4</strong>
                        <small>{form.auto_mp4 !== false ? '已开启，auto 遇到 MOV/AVI/TS 等会输出 MP4' : '已关闭，auto 严格沿用源文件后缀'}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={form.auto_mp4 !== false}
                        onChange={(event) => setForm((old) => ({ ...old, auto_mp4: event.target.checked }))}
                      />
                      <i aria-hidden="true" />
                    </label>
                  </div>
                </section>

                <section className="panel workspace-panel transcode-tasks-panel">
                  <div className="transcode-tasks-head">
                    <div className="section-title"><Activity size={18} />任务列表</div>
                    {totalEta && <span className="text-muted text-xs">{totalEta}</span>}
                  </div>
                  <div className="transcode-task-list">
                    {tasks.map((task) => (
                      <div key={task.task_id} className="task-card">
                        <div className="flex items-center gap-2">
                          <code>{task.task_id}</code>
                          <span className={`status ${task.status}`}>{task.status}</span>
                          {task.status === 'done' && <button className="icon-btn task-report-btn" type="button" title="PDF 报告" aria-label="PDF 报告" onClick={() => void downloadTaskReport(task.task_id)}><FileText size={14} /></button>}
                          {task.eta && <span className="text-muted ml-auto text-xs">{task.eta}</span>}
                          {(task.status === 'running' || task.status === 'pending') && <button className="icon-btn" title="取消" onClick={() => void apiSend(`/api/transcode/${task.task_id}`, undefined, 'DELETE')}><Square size={15} /></button>}
                        </div>
                        {task.current_file && <div className="mt-2 text-sm">{task.total_files > 1 ? `${task.current_index + 1}/${task.total_files} ` : ''}{task.current_file}</div>}
                        {task.output_path && <div className="text-muted truncate text-xs" title={task.output_path}>输出: {task.output_path}</div>}
                        <div className="progress-track mt-2"><div className="progress-fill" style={{ width: `${task.progress || 0}%` }} /></div>
                        <div className="text-muted mt-1 text-xs">{task.progress || 0}% {task.speed ? `· ${task.speed}` : ''} {task.message}</div>
                      </div>
                    ))}
                    {!tasks.length && <div className="empty-state compact">暂无任务</div>}
                  </div>
                </section>
              </>
            )}

            {(tab === 'benchmark' || tab === 'presets') && (
              <section className="panel workspace-panel">

          {tab === 'benchmark' && (
            <div className="space-y-4 p-4">
              <div className="section-title"><BarChart3 size={18} />跑分测试</div>
              <div className="segmented w-full">
                <button className={benchView === 'leaderboard' ? 'active' : ''} onClick={() => setBenchView('leaderboard')}>排行榜</button>
                <button className={benchView === 'test' ? 'active' : ''} onClick={() => setBenchView('test')}>跑分测试</button>
                <button className={benchView === 'history' ? 'active' : ''} onClick={() => setBenchView('history')} disabled={!benchHistory?.results?.length}>我的记录</button>
              </div>

              {benchView === 'leaderboard' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">{lbEncoders.map((encoder) => <Chip key={encoder} active={lbEncoder === encoder} onClick={() => setLbEncoder(encoder)}>{encoder}</Chip>)}</div>
                  {filteredLeaderboard.map((group) => (
                    <div key={group.encoder}>
                      <h3 className="mb-2 font-semibold">{group.encoder}</h3>
                      <div className="space-y-2">
                        {group.items.map((row, index) => (
                          <div key={`${row.chip}-${index}`} className="grid grid-cols-[150px_1fr] items-center gap-3">
                            <div className="min-w-0 text-sm"><div className="truncate">{row.isMe ? row.note : row.chip}</div><div className="text-muted truncate text-xs">{row.isMe ? row.chip : row.note}</div></div>
                            <div className="score-track"><div className={row.isMe ? 'score-fill mine' : 'score-fill'} style={{ width: `${(row.score / group.items[0].score) * 100}%` }} /><span className={row.isMe ? 'score-value mine' : 'score-value'}>{row.score}</span></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {benchView === 'test' && (
                <div className="space-y-4">
                  <EncoderSupportPanel
                    title="选择跑分编码器"
                    hardware={hardware}
                    hwLoading={hwLoading}
                    selectedEncoders={benchEncoders}
                    onRefresh={() => void detectHardware(true)}
                    onToggle={(name) => setBenchEncoders((old) => old.includes(name) ? old.filter((item) => item !== name) : [...old, name])}
                  />
                  <div className="flex items-center gap-2"><button className="btn primary" disabled={benchLoading} onClick={() => void runBenchmark()}><Play size={16} />开始跑分</button>{benchLoading && <button className="btn" onClick={() => { void apiSend('/api/benchmark/cancel', {}, 'POST'); setBenchLoading(false); }}><X size={16} />取消</button>}<span className="text-muted text-xs">{benchEncoders.length ? `已选 ${benchEncoders.length} 个编码器` : '未选择，将测试全部可用编码器'}</span></div>
                  {benchRoundInfo && <div className="notice">{benchRoundInfo}</div>}
                  <ResultsTable results={benchResults} />
                </div>
              )}

              {benchView === 'history' && <ResultsTable results={benchHistory?.results || []} />}
            </div>
          )}

          {tab === 'presets' && (
            <PresetsWorkspace
              presets={availablePresets}
              availableEncoders={availableEncoders}
              editingPreset={editingPreset}
              editPreset={editPreset}
              newPreset={newPreset}
              onCreate={() => setEditingPreset('__new__')}
              onSelect={(preset) => {
                setEditingPreset(preset.name);
                setEditPreset({ encoder: preset.encoder, crf: preset.crf, preset: preset.preset, extra_args: (preset.extra_args || []).join(' ') });
              }}
              onEditChange={setEditPreset}
              onNewChange={setNewPreset}
              onCancel={() => setEditingPreset(null)}
              onSave={(preset) => void savePreset(preset)}
              onSaveNew={() => void savePreset()}
              onDelete={(preset) => void apiSend(`/api/presets/${encodeURIComponent(preset.name)}`, undefined, 'DELETE').then(loadPresets).then(() => setEditingPreset(null))}
              onReset={(preset) => void apiSend(`/api/presets/${encodeURIComponent(preset.name)}/reset`, {}, 'POST').then(loadPresets).then(() => setEditingPreset(null))}
            />
          )}
              </section>
            )}
          </main>
        </div>
      </div>

      {browserMode && (
        <div className="modal folder-browser-modal" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setBrowserMode(null);
        }}>
          <div className={`modal-card folder-browser-card ${newFolderOpen ? 'with-create-row' : ''}`} role="dialog" aria-modal="true" aria-label={browserTitle(browserMode)} onMouseDown={(event) => event.stopPropagation()}>
            <div className="folder-browser-header">
              <div className="folder-browser-title">
                <span className="folder-browser-icon"><FolderOpen size={18} /></span>
                <div>
                  <h2>{browserTitle(browserMode)}</h2>
                  <p>{browserSubtitle(browserMode)}</p>
                </div>
              </div>
              <div className="folder-browser-header-actions">
                {browserMode === 'output' && (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      void chooseOutputFolder(outputFolderRef.current);
                      setBrowserMode(null);
                    }}
                  >
                    与源目录相同
                  </button>
                )}
                <button className="icon-btn" aria-label="关闭" onClick={() => setBrowserMode(null)}><X size={16} /></button>
              </div>
            </div>
            <div className="folder-browser-pathbar">
              <button className="icon-btn" title="返回上级" aria-label="返回上级" disabled={!fileBrowser.parent} onClick={() => fileBrowser.parent && void browseTo(fileBrowser.parent)}><ChevronLeft size={16} /></button>
              <div className="folder-browser-path">
                <span>当前位置</span>
                <strong title={fileBrowser.current}>{fileBrowser.current}</strong>
              </div>
              <button className="btn folder-browser-new-btn" onClick={() => setNewFolderOpen((open) => !open)}><Plus size={15} />新建文件夹</button>
            </div>
            {newFolderOpen && (
              <form className="folder-create-row" onSubmit={(event) => {
                event.preventDefault();
                void createFolder();
              }}>
                <Folder size={17} />
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="输入文件夹名称"
                  aria-label="新建文件夹名称"
                />
                <button className="btn primary" type="submit" disabled={!newFolderName.trim() || newFolderBusy}>
                  {newFolderBusy ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
                  创建
                </button>
                <button className="btn" type="button" disabled={newFolderBusy} onClick={() => { setNewFolderOpen(false); setNewFolderName(''); }}>取消</button>
              </form>
            )}
            <div className="folder-browser-list">
              {browserFolders.map((entry) => (
                <button key={entry.path} className="folder-option" onClick={() => void browseTo(entry.path)}>
                  <span className="folder-option-icon"><Folder size={18} /></span>
                  <span className="folder-option-text">
                    <span className="folder-option-name">{entry.name || entry.path}</span>
                    <span className="folder-option-path" title={entry.path}>{entry.path}</span>
                  </span>
                  <ChevronRight className="folder-option-arrow" size={17} />
                </button>
              ))}
              {!browserFolders.length && (
                <div className="folder-browser-empty">
                  <FolderOpen size={24} />
                  <span>当前目录下没有可进入的文件夹</span>
                </div>
              )}
            </div>
            <div className="folder-browser-footer">
              <div className="folder-browser-selected">已选 <strong title={fileBrowser.current}>{fileBrowser.current}</strong></div>
              <div className="folder-browser-actions">
                <button className="btn" onClick={() => setBrowserMode(null)}>取消</button>
                <button className="btn primary" onClick={() => {
                  if (browserMode === 'watch') void addWatchFolder(fileBrowser.current);
                  if (browserMode === 'replace') void replaceWatchFolder(replacingFolderRef.current, fileBrowser.current);
                  if (browserMode === 'output') void chooseOutputFolder(fileBrowser.current);
                  setBrowserMode(null);
                }}><Check size={16} />选择此目录</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type ConsolePeriod = 'week' | 'month';
type ResourceMode = 'cpu' | 'ram' | 'gpu';
type PresetVendorFilter = 'cpu' | 'nvidia' | 'intel' | 'amd';

function ConsolePage({
  watchFolders,
  tasks,
  presets,
  globalForm,
  sysInfo,
  systemUsage,
  onBrowseWatchFolder,
  onRefreshWatchFolders,
  wfLoading,
  onRemoveWatchFolder,
  onUpdateFolder,
  onReplaceWatchFolder,
  onBrowseOutputFolder,
  onStartFolderTranscode,
  onCancelTask,
  autoTranscode,
  onAutoTranscodeChange,
}: {
  watchFolders: WatchFolderResult[];
  tasks: TaskInfo[];
  presets: Preset[];
  globalForm: TranscodeForm;
  sysInfo: SystemInfo | null;
  systemUsage: SystemUsage | null;
  onBrowseWatchFolder: () => void;
  onRefreshWatchFolders: () => void;
  wfLoading: boolean;
  onRemoveWatchFolder: (path: string) => void;
  onUpdateFolder: (path: string, patch: WatchFolderPatch) => Promise<void>;
  onReplaceWatchFolder: (path: string) => void;
  onBrowseOutputFolder: (path: string) => void;
  onStartFolderTranscode: (files: string[]) => void;
  onCancelTask: (taskID: string) => void;
  autoTranscode: boolean;
  onAutoTranscodeChange: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [period, setPeriod] = useState<ConsolePeriod>('week');
  const [resourceMode, setResourceMode] = useState<ResourceMode>('cpu');
  const days = period === 'week' ? 7 : 30;
  const fileSizes = useMemo(() => {
    const sizes = new Map<string, number>();
    watchFolders.forEach((wf) => wf.files.forEach((file) => sizes.set(file.path, file.size || 0)));
    return sizes;
  }, [watchFolders]);

  const completedTasks = useMemo(() => tasks.filter((task) => task.status === 'done'), [tasks]);
  const failedTasks = useMemo(() => tasks.filter((task) => task.status === 'failed'), [tasks]);
  const processedBuckets = useMemo(() => bucketTasks(completedTasks, days, taskFileCount), [completedTasks, days]);
  const savedBuckets = useMemo(
    () => bucketTasks(completedTasks, days, (task) => estimateSavedBytes(task, fileSizes)),
    [completedTasks, days, fileSizes],
  );
  const processedFiles = processedBuckets.reduce((sum, value) => sum + value, 0);
  const storageSaved = savedBuckets.reduce((sum, value) => sum + value, 0);
  const runningCount = tasks.filter((task) => task.status === 'running').length;
  const upcomingCount = tasks.filter((task) => task.status === 'pending').length;
  const finishedCount = completedTasks.reduce((sum, task) => sum + taskFileCount(task), 0);
  const failedCount = failedTasks.reduce((sum, task) => sum + taskFileCount(task), 0);
  const resourcePercent = resourceMode === 'cpu'
    ? systemUsage?.cpu_percent
    : resourceMode === 'ram'
      ? systemUsage?.memory_percent
      : systemUsage?.gpu_percent;
  const resourceAvailable = resourceMode === 'cpu'
    ? systemUsage?.cpu_available
    : resourceMode === 'ram'
      ? systemUsage?.memory_available
      : systemUsage?.gpu_available;
  const resourceValue = resourceAvailable
    ? `${Math.round(resourcePercent || 0)}%`
    : '未采集';
  const resourceDetail = resourceMode === 'cpu'
    ? (sysInfo ? `${sysInfo.cores || 0} 核 / ${sysInfo.threads || 0} 线程` : '等待系统信息')
    : resourceMode === 'ram'
      ? (systemUsage?.memory_available ? `${systemUsage.memory_used} / ${systemUsage.memory_total}` : (sysInfo?.memory || '未知'))
      : (systemUsage?.gpu_available ? (systemUsage.gpu_name || sysInfo?.gpu || 'GPU 负载') : (systemUsage?.gpu_message || '未检测到 GPU 负载'));
  const resourcePoints = makeResourcePoints(resourceAvailable ? resourcePercent || 0 : 0);
  const resourceTitle = resourceMode === 'cpu' ? '处理器' : resourceMode === 'ram' ? '内存' : 'GPU';

  return (
    <section className="console-page" aria-label="控制台概览">
      <div className="console-metrics">
        <MetricCard
          title="已处理文件"
          value={formatCompactNumber(processedFiles)}
          detail={processedFiles ? `每天 ${formatCompactNumber(Math.ceil(processedFiles / days))}` : '等待完成任务'}
          tone="green"
          points={processedBuckets}
          toggle={{
            value: period,
            options: [
              { value: 'week', label: '本周' },
              { value: 'month', label: '本月' },
            ],
            onChange: (value) => setPeriod(value as ConsolePeriod),
          }}
        />
        <MetricCard
          title="节省空间"
          value={formatSize(storageSaved)}
          detail={storageSaved ? `每天 ${formatSize(Math.ceil(storageSaved / days))}（估算）` : '等待完成任务'}
          tone="blue"
          icon={HardDrive}
          points={savedBuckets}
          toggle={{
            value: period,
            options: [
              { value: 'week', label: '本周' },
              { value: 'month', label: '本月' },
            ],
            onChange: (value) => setPeriod(value as ConsolePeriod),
          }}
        />
        <MetricCard
          title={resourceTitle}
          value={resourceValue}
          detail={resourceDetail}
          tone="amber"
          icon={Cpu}
          points={resourcePoints}
          toggle={{
            value: resourceMode,
            options: [
              { value: 'cpu', label: '处理器' },
              { value: 'ram', label: '内存' },
              { value: 'gpu', label: 'GPU' },
            ],
            onChange: (value) => setResourceMode(value as ResourceMode),
          }}
        />
      </div>

      <WatchFoldersPanel
        watchFolders={watchFolders}
        tasks={tasks}
        presets={presets}
        globalForm={globalForm}
        onBrowseWatchFolder={onBrowseWatchFolder}
        onRefreshWatchFolders={onRefreshWatchFolders}
        wfLoading={wfLoading}
        onRemoveWatchFolder={onRemoveWatchFolder}
        onUpdateFolder={onUpdateFolder}
        onReplaceWatchFolder={onReplaceWatchFolder}
        onBrowseOutputFolder={onBrowseOutputFolder}
        onStartFolderTranscode={onStartFolderTranscode}
        onCancelTask={onCancelTask}
        autoTranscode={autoTranscode}
        onAutoTranscodeChange={onAutoTranscodeChange}
        statusChips={(
          <div className="file-status-strip">
            <StatusChip tone="running" icon={Activity} label="运行中" value={runningCount} />
            <StatusChip tone="upcoming" icon={Clock3} label="待处理" value={upcomingCount} />
            <StatusChip tone="finished" icon={CircleCheck} label="已完成" value={finishedCount} />
            <StatusChip tone="failed" icon={CircleX} label="失败" value={failedCount} />
          </div>
        )}
      />
    </section>
  );
}

function WatchFoldersPanel({
  watchFolders,
  tasks,
  presets,
  globalForm,
  onBrowseWatchFolder,
  onRefreshWatchFolders,
  wfLoading,
  onRemoveWatchFolder,
  onUpdateFolder,
  onReplaceWatchFolder,
  onBrowseOutputFolder,
  onStartFolderTranscode,
  onCancelTask,
  autoTranscode,
  onAutoTranscodeChange,
  statusChips,
}: {
  watchFolders: WatchFolderResult[];
  tasks: TaskInfo[];
  presets: Preset[];
  globalForm: TranscodeForm;
  onBrowseWatchFolder: () => void;
  onRefreshWatchFolders: () => void;
  wfLoading: boolean;
  onRemoveWatchFolder: (path: string) => void;
  onUpdateFolder: (path: string, patch: WatchFolderPatch) => Promise<void>;
  onReplaceWatchFolder: (path: string) => void;
  onBrowseOutputFolder: (path: string) => void;
  onStartFolderTranscode: (files: string[]) => void;
  onCancelTask: (taskID: string) => void;
  autoTranscode: boolean;
  onAutoTranscodeChange: React.Dispatch<React.SetStateAction<boolean>>;
  statusChips?: React.ReactNode;
}) {
  const [settingsFolderPath, setSettingsFolderPath] = useState<string | null>(null);
  const settingsFolder = watchFolders.find((wf) => wf.folder.path === settingsFolderPath) ?? null;

  return (
    <section className="watch-folders-panel">
      <div className="watch-folder-toolbar">
        <div className="section-title"><Folder size={18} />目录监控</div>
        {statusChips}
        <button className="btn primary" onClick={onBrowseWatchFolder}><FolderOpen size={16} />添加</button>
        <button className="icon-btn" title="刷新" onClick={onRefreshWatchFolders}>{wfLoading ? <Loader2 className="animate-spin" size={17} /> : <RefreshCw size={17} />}</button>
      </div>
      <div className="watch-folder-list">
        {watchFolders.map((wf) => {
          const outputPath = outputFolderPath(wf.folder);
          const outputDest = normalizedOutputDest(wf.folder);
          const needsCustomOutput = outputDest === 'custom' && !wf.folder.output_dir;
          const outputUnset = !outputDest;
          const taskName = wf.folder.label || folderName(wf.folder.path);
          const folderFiles = wf.files.map((file) => file.path);
          const activeTask = tasks.find((task) => isActiveTranscodeTask(task) && taskTouchesFolder(task, wf.folder.path));
          const activeProgress = activeTask ? taskOverallProgressPercent(activeTask) : 0;
          const activeProgressLabel = formatProgressPercent(activeProgress);
          return (
            <div
              key={wf.folder.path}
              className={`watch-folder-card ${activeTask ? 'is-running' : ''}`}
              style={activeTask ? ({ '--watch-folder-progress': `${activeProgress}%` } as React.CSSProperties) : undefined}
            >
              <div className="watch-folder-card-head">
                <div className="watch-folder-identity">
                  <span className="watch-folder-icon"><FolderOpen size={28} /></span>
                  <div className="watch-folder-title-block">
                    <input
                      className="watch-folder-title-input"
                      value={wf.folder.label || ''}
                      onChange={(event) => onUpdateFolder(wf.folder.path, { label: event.target.value })}
                      placeholder={folderName(wf.folder.path)}
                      aria-label="目录监控备注名"
                    />
                    <FolderPresetPicker
                      folder={wf.folder}
                      presets={presets}
                      globalForm={globalForm}
                      onChange={(presetName) => void onUpdateFolder(wf.folder.path, { preset_name: presetName })}
                    />
                    <div className="watch-folder-meta">
                      <span className={`watch-folder-state ${activeTask ? 'running' : 'ok'}`}>
                        {activeTask ? `转码中 ${activeProgressLabel}` : '监控中'}
                      </span>
                      <span>{wf.folder.file_count} 个视频</span>
                      <span>{formatSize(wf.folder.total_size)}</span>
                    </div>
                  </div>
                </div>
                <div className="watch-folder-head-actions">
                  {activeTask ? (
                    <button className="icon-btn danger" title="取消转码" onClick={() => onCancelTask(activeTask.task_id)}><Square size={16} /></button>
                  ) : (
                  <button className="icon-btn" title="开始转码" disabled={!folderFiles.length || outputUnset || needsCustomOutput} onClick={() => onStartFolderTranscode(folderFiles)}><Play size={16} /></button>
                  )}
                  <button className="icon-btn" title="更多设置" onClick={() => setSettingsFolderPath(wf.folder.path)}><MoreHorizontal size={18} /></button>
                  <button className="icon-btn danger" title="删除" onClick={() => onRemoveWatchFolder(wf.folder.path)}><Trash2 size={16} /></button>
                </div>
              </div>
              <div className="watch-folder-card-body">
                <FolderPathCard
                  title={taskName}
                  path={wf.folder.path}
                  detail="本地监控目录"
                  action={() => onReplaceWatchFolder(wf.folder.path)}
                />
                <div className="folder-route-arrow" aria-hidden="true"><ChevronRight size={19} /></div>
                <div className="watch-folder-target">
                  <FolderPathCard
                    title={outputUnset || needsCustomOutput ? '选择目标目录' : outputPath.label}
                    path={outputUnset ? '尚未设置输出位置' : needsCustomOutput ? '点击选择转码输出位置' : outputPath.path}
                    detail={outputPath.detail}
                    action={() => onBrowseOutputFolder(wf.folder.path)}
                    muted={outputUnset || needsCustomOutput}
                    warning={outputUnset || needsCustomOutput}
                  />
                </div>
                <div className="watch-folder-next">
                  {activeTask ? (
                    <>
                      <span>进度</span>
                      <strong className="watch-folder-progress-text">{activeProgressLabel}</strong>
                    </>
                  ) : (
                    <>
                      <span>下次</span>
                      <strong>-</strong>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!watchFolders.length && <div className="empty-state compact">尚未添加目录监控</div>}
      </div>
      {settingsFolder && (
        <WatchFolderSettingsModal
          wf={settingsFolder}
          onClose={() => setSettingsFolderPath(null)}
          onUpdateFolder={onUpdateFolder}
          onBrowseOutputFolder={onBrowseOutputFolder}
          onStartFolderTranscode={onStartFolderTranscode}
          onCancelTask={onCancelTask}
          presets={presets}
          globalForm={globalForm}
          activeTask={tasks.find((task) => isActiveTranscodeTask(task) && taskTouchesFolder(task, settingsFolder.folder.path)) ?? null}
          autoTranscode={autoTranscode}
          onAutoTranscodeChange={onAutoTranscodeChange}
        />
      )}
    </section>
  );
}

function WatchFolderSettingsModal({
  wf,
  onClose,
  onUpdateFolder,
  onBrowseOutputFolder,
  onStartFolderTranscode,
  onCancelTask,
  presets,
  globalForm,
  activeTask,
  autoTranscode,
  onAutoTranscodeChange,
}: {
  wf: WatchFolderResult;
  onClose: () => void;
  onUpdateFolder: (path: string, patch: WatchFolderPatch) => Promise<void>;
  onBrowseOutputFolder: (path: string) => void;
  onStartFolderTranscode: (files: string[]) => void;
  onCancelTask: (taskID: string) => void;
  presets: Preset[];
  globalForm: TranscodeForm;
  activeTask: TaskInfo | null;
  autoTranscode: boolean;
  onAutoTranscodeChange: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [activeTab, setActiveTab] = useState<'output' | 'preset' | 'action' | 'advanced'>('output');
  const outputPath = outputFolderPath(wf.folder);
  const outputDest = normalizedOutputDest(wf.folder);
  const selectedPreset = presets.find((preset) => preset.name === wf.folder.preset_name) ?? null;
  const presetLabel = folderPresetLabel(wf.folder, presets, globalForm);
  const folderFiles = wf.files.map((file) => file.path);
  const outputOptions = [
    { value: 'beside', title: '源文件旁', detail: '转码后文件和源文件放在同一目录' },
    { value: 'subfolder', title: 'AV1子目录', detail: '输出到监控目录下的 AV1 文件夹' },
    { value: 'custom', title: '自定义目录', detail: wf.folder.output_dir || '选择一个固定目标目录' },
  ];

  return (
    <div className="modal watch-settings-modal" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="watch-settings-card" role="dialog" aria-modal="true" aria-label="目录监控设置" onMouseDown={(event) => event.stopPropagation()}>
        <div className="watch-settings-head">
          <h2>目录监控设置</h2>
          <button className="icon-btn" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="watch-settings-tabs" role="tablist">
          <button className={activeTab === 'output' ? 'active' : ''} onClick={() => setActiveTab('output')}>输出方式</button>
          <button className={activeTab === 'preset' ? 'active' : ''} onClick={() => setActiveTab('preset')}>编码预设</button>
          <button className={activeTab === 'action' ? 'active' : ''} onClick={() => setActiveTab('action')}>手动处理</button>
          <button className={activeTab === 'advanced' ? 'active' : ''} onClick={() => setActiveTab('advanced')}>高级设置</button>
        </div>

        <div className="watch-settings-body">
          {activeTab === 'output' && (
            <div className="watch-settings-section">
              <div className="watch-settings-summary">
                <span>当前输出</span>
                <strong>{outputPath.label}</strong>
                <small title={outputPath.path}>{outputPath.path}</small>
              </div>
              <div className="watch-output-options">
                {outputOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`watch-output-option ${outputDest === option.value ? 'active' : ''}`}
                    onClick={() => onUpdateFolder(wf.folder.path, { output_dest: option.value })}
                  >
                    <span className="radio-dot" aria-hidden="true" />
                    <span>
                      <strong>{option.title}</strong>
                      <small>{option.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
              {outputDest === 'custom' && (
                <button className="btn" onClick={() => onBrowseOutputFolder(wf.folder.path)}><FolderOpen size={16} />选择目标目录</button>
              )}
            </div>
          )}

          {activeTab === 'preset' && (
            <div className="watch-settings-section">
              <div className="watch-settings-summary">
                <span>当前预设</span>
                <strong>{selectedPreset?.name || '使用全局设置'}</strong>
                <small title={presetLabel}>{presetLabel}</small>
              </div>
              <div className="watch-preset-options">
                <button
                  className={`watch-preset-option ${!wf.folder.preset_name ? 'active' : ''}`}
                  type="button"
                  onClick={() => onUpdateFolder(wf.folder.path, { preset_name: '' })}
                >
                  <span className="radio-dot" aria-hidden="true" />
                  <span>
                    <strong>使用全局转码设置</strong>
                    <small>{folderPresetLabel({ ...wf.folder, preset_name: '' }, presets, globalForm)}</small>
                  </span>
                </button>
                {presets.map((preset) => (
                  <button
                    key={preset.name}
                    className={`watch-preset-option ${wf.folder.preset_name === preset.name ? 'active' : ''}`}
                    type="button"
                    onClick={() => onUpdateFolder(wf.folder.path, { preset_name: preset.name })}
                  >
                    <span className="radio-dot" aria-hidden="true" />
                    <span>
                      <strong>{preset.name}</strong>
                      <small>{presetSummaryLine(preset)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'action' && (
            <div className="watch-settings-section">
              <div className="watch-settings-summary">
                <span>待处理文件</span>
                <strong>{wf.files.length} 个</strong>
                <small>{!outputDest ? '请先设置输出方式' : formatSize(wf.folder.total_size)}</small>
              </div>
              {activeTask ? (
                <button className="btn danger" onClick={() => onCancelTask(activeTask.task_id)}><Square size={16} />取消转码</button>
              ) : (
                <button className="btn primary" disabled={!folderFiles.length || !outputDest || (outputDest === 'custom' && !wf.folder.output_dir)} onClick={() => onStartFolderTranscode(folderFiles)}><Play size={16} />开始转码</button>
              )}
            </div>
          )}

          {activeTab === 'advanced' && (
            <div className="watch-settings-section">
              <div className="watch-settings-summary">
                <span>自动化</span>
                <strong>高级设置</strong>
                <small>控制目录监控自动行为和已是 AV1 的源文件处理方式</small>
              </div>
              <label className="toggle-card">
                <span>
                  <strong>新文件自动转码</strong>
                  <small>{autoTranscode ? '已开启' : '已关闭'}</small>
                </span>
                <input type="checkbox" checked={autoTranscode} onChange={(event) => onAutoTranscodeChange(event.target.checked)} />
                <i aria-hidden="true" />
              </label>
              <label className="toggle-card">
                <span>
                  <strong>AV1 源文件直接复制</strong>
                  <small>{wf.folder.copy_av1 !== false ? '已开启，源文件为 AV1 时复制到目的地' : '已关闭，源文件为 AV1 时保持不动'}</small>
                </span>
                <input type="checkbox" checked={wf.folder.copy_av1 !== false} onChange={(event) => onUpdateFolder(wf.folder.path, { copy_av1: event.target.checked })} />
                <i aria-hidden="true" />
              </label>
            </div>
          )}
        </div>

        <div className="watch-settings-footer">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={onClose}>确认</button>
        </div>
      </div>
    </div>
  );
}

function FolderPathCard({ title, path, detail, action, muted = false, warning = false }: { title: string; path: string; detail: string; action?: () => void; muted?: boolean; warning?: boolean }) {
  const className = `folder-path-card ${action ? 'action' : ''} ${muted ? 'muted' : ''} ${warning ? 'warning' : ''}`;
  const content = (
    <>
      <div className="folder-path-title"><Folder size={17} />{title}</div>
      <div className="folder-path-value" title={path}>{path}</div>
      <div className="folder-path-detail">{detail}</div>
    </>
  );
  if (action) {
    return (
      <button type="button" className={className} onClick={action}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

function outputFolderPath(folder: WatchFolder) {
  const outputDest = normalizedOutputDest(folder);
  if (!outputDest) {
    return { label: '未设置输出', path: '', detail: '请选择输出方式' };
  }
  if (outputDest === 'subfolder') {
    return { label: 'AV1子目录', path: joinPath(folder.path, 'AV1'), detail: '输出到监控目录下的 AV1 文件夹' };
  }
  if (outputDest === 'custom') {
    return {
      label: folder.output_dir ? folderName(folder.output_dir) : '选择目标目录',
      path: folder.output_dir || '点击选择转码输出位置',
      detail: folder.output_dir ? '自定义输出目录' : '尚未选择目标目录',
    };
  }
  return { label: folder.label || folderName(folder.path), path: folder.path, detail: '输出到源文件所在目录' };
}

function normalizedOutputDest(folder: WatchFolder) {
  if (folder.output_dest === 'custom' && folder.output_dir && sameFolderPath(folder.output_dir, folder.path)) {
    return 'beside';
  }
  return folder.output_dest || '';
}

function MetricCard({
  title,
  value,
  detail,
  tone,
  points,
  icon: Icon,
  toggle,
}: {
  title: string;
  value: string;
  detail: string;
  tone: 'green' | 'blue' | 'amber';
  points: number[];
  icon?: typeof Activity;
  toggle: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  };
}) {
  return (
    <div className={`metric-card metric-card-${tone}`}>
      <div className="metric-card-head">
        <h3>{title}</h3>
        <div className="metric-toggle" aria-label={`${title}切换`}>
          {toggle.options.map((option) => (
            <button key={option.value} className={toggle.value === option.value ? 'active' : ''} onClick={() => toggle.onChange(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="metric-value-row">
        {Icon && <div className="metric-icon"><Icon size={22} /></div>}
        <div>
          <div className="metric-number">{value}</div>
          <div className="metric-detail">{detail}</div>
        </div>
      </div>
      <MetricSparkline points={points} />
    </div>
  );
}

function MetricSparkline({ points }: { points: number[] }) {
  const safePoints = points.length ? points : [0];
  const max = Math.max(...safePoints, 1);
  const step = safePoints.length > 1 ? 100 / (safePoints.length - 1) : 100;
  const line = safePoints
    .map((point, index) => {
      const x = Number((index * step).toFixed(2));
      const y = Number((38 - (point / max) * 28).toFixed(2));
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
  const area = `${line} L 100 40 L 0 40 Z`;

  return (
    <svg className="metric-chart" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path className="metric-area" d={area} />
      <path className="metric-line" d={line} />
    </svg>
  );
}

function StatusChip({ tone, icon: Icon, label, value }: { tone: 'running' | 'upcoming' | 'finished' | 'failed'; icon: typeof Activity; label: string; value: number }) {
  return (
    <div className={`file-status-chip ${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{formatCompactNumber(value)}</strong>
    </div>
  );
}

function FolderPresetPicker({
  folder,
  presets,
  globalForm,
  onChange,
}: {
  folder: WatchFolder;
  presets: Preset[];
  globalForm: TranscodeForm;
  onChange: (presetName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [vendorFilter, setVendorFilter] = useState<PresetVendorFilter>('cpu');
  const ref = useRef<HTMLDivElement>(null);
  const label = folderPresetLabel(folder, presets, globalForm);
  const selectedPreset = presets.find((preset) => preset.name === folder.preset_name);
  const selectedVendor = selectedPreset ? presetVendor(selectedPreset.encoder) : presetVendor(globalForm.encoder);
  const options = useMemo(
    () => presets.filter((preset) => presetVendor(preset.encoder) === vendorFilter),
    [presets, vendorFilter],
  );

  useClickOutside(ref, open, () => setOpen(false));

  return (
    <div className="file-manager-preset-picker" ref={ref}>
      <button
        className="file-manager-preset"
        type="button"
        title={label}
        onClick={() => {
          setVendorFilter(selectedVendor);
          setOpen((value) => !value);
        }}
      >
        {label}<ChevronDown size={12} />
      </button>
      {open && (
        <div className="file-manager-preset-menu">
          <div className="file-manager-preset-filter" aria-label="预设厂商筛选">
            {presetVendorFilters.map((filter) => (
              <button
                key={filter.value}
                className={vendorFilter === filter.value ? 'active' : ''}
                type="button"
                onClick={() => setVendorFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <button
            className={!folder.preset_name ? 'active' : ''}
            type="button"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            <strong>使用全局设置</strong>
            <span>{folderPresetLabel({ ...folder, preset_name: '' }, presets, globalForm)}</span>
          </button>
          {options.map((preset) => (
            <button
              key={preset.name}
              className={folder.preset_name === preset.name ? 'active' : ''}
              type="button"
              onClick={() => {
                onChange(preset.name);
                setOpen(false);
              }}
            >
              <strong>{preset.name}</strong>
              <span>{presetSummaryLine(preset)}</span>
            </button>
          ))}
          {!options.length && <div className="file-manager-preset-empty">当前分类没有可用预设</div>}
        </div>
      )}
    </div>
  );
}

function FileManagerPage({
  watchFolders,
  selectedPath,
  globalForm,
  data,
  loading,
  tasks,
  presets,
  actions,
  items,
  filteredItems,
  onSelectFolder,
  onUpdateFolder,
  onBrowseOutputFolder,
  onRefresh,
  onStartFolderTranscode,
  onToggleAction,
  onToggleItemStatus,
  onToggleAllItems,
  onRunSelected,
  onReport,
  onCancel,
  autoTranscode,
  onAutoTranscodeChange,
}: {
  watchFolders: WatchFolderResult[];
  selectedPath: string;
  globalForm: TranscodeForm;
  data: ManagedFolderResponse | null;
  loading: boolean;
  tasks: TaskInfo[];
  presets: Preset[];
  actions: ManagedStatus[];
  items: ManagedFileItem[];
  filteredItems: ManagedFileItem[];
  onSelectFolder: (path: string) => void;
  onUpdateFolder: (path: string, patch: WatchFolderPatch) => Promise<void>;
  onBrowseOutputFolder: (path: string) => void;
  onRefresh: () => Promise<void>;
  onStartFolderTranscode: (files: string[]) => void;
  onToggleAction: (status: ManagedStatus) => void;
  onToggleItemStatus: (item: ManagedFileItem) => void;
  onToggleAllItems: (status: ManagedStatus) => void;
  onRunSelected: () => void;
  onReport: () => void;
  onCancel: () => void;
  autoTranscode: boolean;
  onAutoTranscodeChange: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [justCompleted, setJustCompleted] = useState<Set<string>>(() => new Set());
  const previousRunningRef = useRef<Set<string>>(new Set());
  const selectedWatchFolder = watchFolders.find((wf) => wf.folder.path === selectedPath) ?? null;
  const statusCounts = useMemo(() => {
    const counts: Record<ManagedStatus, number> = { keep: 0, add: 0, force: 0, running: 0 };
    for (const item of items) counts[item.status] += 1;
    return counts;
  }, [items]);
  const toggleableItems = useMemo(() => items.filter((item) => item.status !== 'running'), [items]);
  const allToggleableAdded = toggleableItems.length > 0 && toggleableItems.every((item) => item.status === 'add');
  const progress = clampPercent(data?.summary.progress || 0);
  const progressLabel = formatProgressPercent(progress);
  const currentPresetLabel = useMemo(
    () => selectedWatchFolder
      ? folderPresetLabel(selectedWatchFolder.folder, presets, globalForm)
      : managedFolderPresetLabel(tasks, presets, selectedPath, undefined, data?.summary.active_task_id),
	    [data?.summary.active_task_id, globalForm, presets, selectedPath, selectedWatchFolder, tasks],
  );
  const targetProgress = useMemo(() => {
    const map = new Map<string, { progress: number; task: TaskInfo }>();
    for (const task of tasks) {
      if (task.status !== 'running' && task.status !== 'pending') continue;
      const value = task.status === 'pending' ? 0 : Math.max(0, Math.min(100, task.current_file_progress || task.progress || 0));
      if (task.output_path) map.set(task.output_path, { progress: value, task });
      const currentFile = task.request?.files?.[task.current_index];
      if (currentFile) map.set(currentFile, { progress: value, task });
      if (task.current_file) map.set(task.current_file, { progress: value, task });
    }
    return map;
  }, [tasks]);
  const refreshAfterFolderUpdate = useCallback(
    async (path: string, patch: WatchFolderPatch) => {
      await onUpdateFolder(path, patch);
      if (path === selectedPath) await onRefresh();
    },
    [onRefresh, onUpdateFolder, selectedPath],
  );

  useEffect(() => {
    const running = new Set(items.filter((item) => item.status === 'running').map((item) => item.id));
    const completed = [...previousRunningRef.current].filter((id) => {
      const item = items.find((candidate) => candidate.id === id);
      return item && item.status === 'keep' && !running.has(id);
    });
    previousRunningRef.current = running;
    if (!completed.length) return;
    setJustCompleted((old) => new Set([...old, ...completed]));
    const timer = window.setTimeout(() => {
      setJustCompleted((old) => {
        const next = new Set(old);
        completed.forEach((id) => next.delete(id));
        return next;
      });
    }, completedFlashMs);
    return () => window.clearTimeout(timer);
  }, [items]);

  return (
    <section className="file-manager" aria-label="文件管理">
      <aside className="file-manager-rail">
        <div className="file-manager-folder-list">
          {watchFolders.map((wf) => (
            <button
              key={wf.folder.path}
              className={`file-manager-folder ${selectedPath === wf.folder.path ? 'active' : ''}`}
              onClick={() => onSelectFolder(wf.folder.path)}
            >
              <strong>{wf.folder.label || folderName(wf.folder.path)}</strong>
              <span>{wf.files.length} 个文件</span>
            </button>
          ))}
          {!watchFolders.length && <div className="empty-state compact">暂无目录监控</div>}
        </div>
      </aside>

      <section className="file-manager-main">
        <div className="file-manager-head">
          <div className="file-manager-title">
            <div className="file-manager-title-row">
              <h2>{data?.summary.name || '文件管理'}</h2>
              {selectedWatchFolder ? (
                <FolderPresetPicker
                  folder={selectedWatchFolder.folder}
                  presets={presets}
                  globalForm={globalForm}
                  onChange={(presetName) => void refreshAfterFolderUpdate(selectedWatchFolder.folder.path, { preset_name: presetName })}
                />
              ) : currentPresetLabel ? (
                <span className="file-manager-preset passive" title={currentPresetLabel}>{currentPresetLabel}</span>
              ) : null}
              <button className="icon-btn file-manager-report-btn" title="生成报告" aria-label="生成报告" onClick={onReport}><FileText size={16} /></button>
            </div>
            <p><span>来源</span>{data?.summary.source || '-'}<span>目的地</span>{data?.summary.target || '-'}</p>
            <div className="file-manager-stats">
              <b>{formatSize(data?.summary.source_size || 0)}</b>
              <b>{data?.summary.file_count || 0} 个文件</b>
              <b>上次开始 {formatDateTime(data?.summary.created_at)}</b>
              <b>上次结束 {formatDateTime(data?.summary.finished_at)}</b>
              <b>上次运行时长 {formatDuration(data?.summary.duration_sec || 0)}</b>
            </div>
          </div>
          <div className="file-manager-progress">
            <strong>{progressLabel}</strong>
            <span>当前任务进度</span>
            <div className="file-manager-progress-actions">
              <button
                className={`btn file-manager-select-all ${allToggleableAdded ? 'active' : ''}`}
                disabled={!toggleableItems.length}
                onClick={() => onToggleAllItems(allToggleableAdded ? 'keep' : 'add')}
              >
                {allToggleableAdded ? '全不选' : '一键全选'}
              </button>
              <button className="icon-btn" title="更多设置" disabled={!selectedWatchFolder} onClick={() => setSettingsOpen(true)}><MoreHorizontal size={18} /></button>
              <button className="icon-btn file-manager-refresh" title={loading ? '正在刷新' : '刷新'} disabled={loading} onClick={onRefresh}><RefreshCw size={16} /></button>
              <button className="btn" disabled={!data?.summary.active_task_id} onClick={onCancel}><Square size={15} />取消</button>
            </div>
          </div>
        </div>

        <div className="file-compare-list">
          {filteredItems.map((item) => (
            (() => {
              const active = targetProgress.get(item.target.path)
                || targetProgress.get(item.source.path)
                || targetProgress.get(item.source.name)
                || targetProgress.get(item.target.name);
              return (
                <FileCompareRow
                  key={item.id}
                  item={item}
                  progress={active?.progress || 0}
                  running={item.status === 'running' || Boolean(active)}
                  completedFlash={justCompleted.has(item.id)}
                  onToggleStatus={() => onToggleItemStatus(item)}
                />
              );
            })()
          ))}
          {!filteredItems.length && <div className="empty-state compact">{loading ? '正在读取文件对比' : '当前筛选下没有文件'}</div>}
        </div>

        <div className="file-manager-filterbar">
          <StatusFilterButton status="keep" active={actions.includes('keep')} count={statusCounts.keep} onClick={() => onToggleAction('keep')} />
          <StatusFilterButton status="add" active={actions.includes('add')} count={statusCounts.add} onClick={() => onToggleAction('add')} />
          <StatusFilterButton status="force" active={actions.includes('force')} count={statusCounts.force} onClick={() => onToggleAction('force')} />
          <button className="btn primary file-manager-run-bottom" onClick={onRunSelected}><Play size={15} />立即执行</button>
        </div>
      </section>
      {settingsOpen && selectedWatchFolder && (
        <WatchFolderSettingsModal
          wf={selectedWatchFolder}
          onClose={() => setSettingsOpen(false)}
          onUpdateFolder={refreshAfterFolderUpdate}
          onBrowseOutputFolder={onBrowseOutputFolder}
          onStartFolderTranscode={onStartFolderTranscode}
          onCancelTask={() => onCancel()}
          presets={presets}
          globalForm={globalForm}
          activeTask={tasks.find((task) => isActiveTranscodeTask(task) && taskTouchesFolder(task, selectedWatchFolder.folder.path)) ?? null}
          autoTranscode={autoTranscode}
          onAutoTranscodeChange={onAutoTranscodeChange}
        />
      )}
    </section>
  );
}

function FileCompareRow({
  item,
  progress,
  running,
  completedFlash,
  onToggleStatus,
}: {
  item: ManagedFileItem;
  progress: number;
  running: boolean;
  completedFlash: boolean;
  onToggleStatus: () => void;
}) {
  const canToggle = !running && (item.status === 'keep' || item.status === 'add');
  const actionStatus = running ? 'running' : item.status;
  return (
    <div className={`file-compare-row status-${actionStatus}`}>
      <FileSideCard side={item.source} />
      <button
        className={`file-compare-action ${actionStatus}`}
        type="button"
        disabled={!canToggle}
        title={running ? `正在转码 ${formatProgressPercent(progress)}` : canToggle ? '切换保持/新增' : '强制转码'}
        onClick={canToggle ? onToggleStatus : undefined}
      >
        {actionStatus === 'keep' && <span className="action-minus" />}
        {actionStatus === 'add' && <><Plus size={14} className="action-plus" /><ChevronRight size={23} /></>}
        {actionStatus === 'force' && <ZapIcon />}
        {actionStatus === 'running' && <Loader2 className="animate-spin" size={18} />}
      </button>
      <FileSideCard
        side={item.target}
        muted={!item.target.exists}
        message={actionStatus === 'add' ? undefined : item.message}
        progress={running ? progress : 0}
        progressing={running}
        completedFlash={completedFlash}
      />
    </div>
  );
}

function FileSideCard({
  side,
  muted = false,
  message,
  progress = 0,
  progressing = false,
  completedFlash = false,
}: {
  side: ManagedFileSide;
  muted?: boolean;
  message?: string;
  progress?: number;
  progressing?: boolean;
  completedFlash?: boolean;
}) {
  const tags = mediaTags(side.meta);
  const displayTitle = side.relative_path || (side.relative_dir ? `${side.relative_dir}/${side.name}` : side.name);
  const progressValue = Math.max(0, Math.min(100, progress));
  return (
    <div
      className={`file-side-card ${muted ? 'muted' : ''} ${progressing ? 'progressing' : ''} ${completedFlash ? 'completed-flash' : ''}`}
      style={{ '--file-progress': `${progressValue}%` } as React.CSSProperties}
    >
      <h3 title={side.path}>{displayTitle}</h3>
      <div className="file-side-meta">
        {tags.map((tag) => <span key={tag.label} className={`file-tag ${tag.tone}`}>{tag.label}</span>)}
        {!tags.length && <span className="file-tag muted">待识别</span>}
        <span>{side.exists ? formatSize(side.size) : '未生成'}</span>
        {message && <span>{message}</span>}
      </div>
    </div>
  );
}

function StatusFilterButton({ status, active, count, onClick }: { status: ManagedStatus; active: boolean; count: number; onClick: () => void }) {
  return (
    <button className={`status-filter ${status} ${active ? 'active' : ''}`} onClick={onClick}>
      <StatusGlyph status={status} />
      <span>{managedStatusLabel(status)}</span>
      <b>{count}</b>
    </button>
  );
}

function StatusGlyph({ status }: { status: ManagedStatus }) {
  if (status === 'keep') return <span className="action-minus" />;
  if (status === 'add') return <span className="status-add-glyph"><Plus size={12} /><ChevronRight size={18} /></span>;
  if (status === 'running') return <Loader2 className="animate-spin" size={16} />;
  return <ZapIcon />;
}

function ZapIcon() {
  return <Zap className="zap-icon" size={18} aria-hidden="true" />;
}

function OnlinePage({
  jobs,
  tasks,
  presets,
  selectedPreset,
  onPresetChange,
  onUpload,
  onDeleteJob,
  onDownloadReport,
}: {
  jobs: OnlineJob[];
  tasks: TaskInfo[];
  presets: Preset[];
  selectedPreset: string;
  onPresetChange: (name: string) => void;
  onUpload: (files: File[]) => void;
  onDeleteJob: (job: OnlineJob) => void;
  onDownloadReport: (taskID?: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const presetRef = useRef<HTMLDivElement>(null);
  const taskByID = useMemo(() => new Map(tasks.map((task) => [task.task_id, task])), [tasks]);
  const currentPreset = useMemo(
    () => presets.find((preset) => preset.name === selectedPreset) ?? null,
    [presets, selectedPreset],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const acceptFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList || []).filter((file) => file.size > 0);
    if (files.length) onUpload(files);
  };
  const choosePreset = (name: string) => {
    onPresetChange(name);
    setPresetOpen(false);
  };
  useClickOutside(presetRef, presetOpen, () => setPresetOpen(false));

  return (
    <section className="online-page">
      <div className={`online-dropzone ${dragging ? 'active' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          acceptFiles(event.dataTransfer.files);
        }}
      >
        <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => acceptFiles(event.target.files)} />
        <div className="online-drop-icon"><CloudUpload size={34} /></div>
        <div>
          <h3>拖拽文件到这里开始在线转码</h3>
          <p>文件会先进入服务器缓存目录，转码完成后可直接在浏览器下载。</p>
        </div>
        <button className="btn primary" onClick={() => fileInputRef.current?.click()}><FileUpIcon />选择文件</button>
        <div className="online-preset-picker" ref={presetRef}>
          <button
            className={`online-preset-trigger ${presetOpen ? 'active' : ''}`}
            type="button"
            onClick={() => setPresetOpen((open) => !open)}
          >
            <span>{currentPreset?.name || '选择预设'}</span>
            <ChevronDown size={16} />
          </button>
          {presetOpen && (
            <div className="online-preset-menu">
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  className={preset.name === selectedPreset ? 'active' : ''}
                  type="button"
                  onClick={() => choosePreset(preset.name)}
                >
                  <strong>{preset.name}</strong>
                  <span>{presetSummaryLine(preset)}</span>
                </button>
              ))}
              {!presets.length && <div className="online-preset-empty">暂无本机可用预设</div>}
            </div>
          )}
          <PresetSummaryLine preset={currentPreset} />
        </div>
      </div>

      <div className="online-job-list">
        <div className="section-title"><FileDown size={18} />在线任务</div>
        {jobs.map((job) => {
          const task = job.task_id ? taskByID.get(job.task_id) : undefined;
          const status = task?.status || job.status;
          const progress = task?.progress ?? job.progress;
          const message = task?.message || task?.current_file || job.message;
          const downloadURL = job.download_url || (job.task_id ? `/api/online/download/${job.task_id}` : '');
          return (
            <div key={job.id} className="online-job-card">
              <div className="online-job-head">
                <div className="min-w-0">
                  <strong title={job.name}>{job.name}</strong>
                  <span>{formatSize(job.size)} · {job.task_id || '等待任务号'}</span>
                </div>
                <div className="online-job-head-actions">
                  <span className={`status ${status}`}>{statusText(status)}</span>
                  <button className="icon-btn danger" type="button" title="删除任务" onClick={() => onDeleteJob(job)}><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="progress-track mt-3"><div className="progress-fill" style={{ width: `${progress || 0}%` }} /></div>
              <div className="online-job-foot">
                <span>{Math.round(progress || 0)}% {message ? `· ${message}` : ''}</span>
                {status === 'done' && downloadURL && (
                  <div className="online-job-actions">
                    <button className="btn" type="button" onClick={() => onDownloadReport(job.task_id)}><FileText size={16} />PDF 报告</button>
                    <a className="btn primary" href={downloadURL}><Download size={16} />下载</a>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!jobs.length && <div className="empty-state compact">还没有在线任务</div>}
      </div>
    </section>
  );
}

function FileUpIcon() {
  return <CloudUpload size={16} />;
}

function PresetSummaryLine({ preset }: { preset: Preset | null }) {
  if (!preset) return null;
  return <div className="online-preset-summary-line">{presetSummaryLine(preset)}</div>;
}

function PresetsWorkspace({
  presets,
  availableEncoders,
  editingPreset,
  editPreset,
  newPreset,
  onCreate,
  onSelect,
  onEditChange,
  onNewChange,
  onCancel,
  onSave,
  onSaveNew,
  onDelete,
  onReset,
}: {
  presets: Preset[];
  availableEncoders: EncoderInfo[];
  editingPreset: string | null;
  editPreset: { encoder: string; crf: number; preset: number | string; extra_args: string };
  newPreset: { name: string; encoder: string; crf: number; preset: number | string; extra_args: string; output_ext: string };
  onCreate: () => void;
  onSelect: (preset: Preset) => void;
  onEditChange: React.Dispatch<React.SetStateAction<{ encoder: string; crf: number; preset: number | string; extra_args: string }>>;
  onNewChange: React.Dispatch<React.SetStateAction<{ name: string; encoder: string; crf: number; preset: number | string; extra_args: string; output_ext: string }>>;
  onCancel: () => void;
  onSave: (preset: Preset) => void;
  onSaveNew: () => void;
  onDelete: (preset: Preset) => void;
  onReset: (preset: Preset) => void;
}) {
  const [vendorFilter, setVendorFilter] = useState<PresetVendorFilter>('cpu');
  const selectedPreset = presets.find((preset) => preset.name === editingPreset) ?? null;
  const creating = editingPreset === '__new__';
  const filteredPresets = presets.filter((preset) => presetVendor(preset.encoder) === vendorFilter);
  const creatingVisible = creating && presetVendor(newPreset.encoder) === vendorFilter;
  const previewPreset: Preset | null = creating
    ? {
      name: newPreset.name || '新建预设',
      encoder: newPreset.encoder,
      crf: Number(newPreset.crf),
      preset: newPreset.preset,
      extra_args: splitArgs(newPreset.extra_args),
      builtin: false,
      output_ext: newPreset.output_ext,
    }
    : selectedPreset
      ? {
        ...selectedPreset,
        encoder: editPreset.encoder,
        crf: Number(editPreset.crf),
        preset: editPreset.preset,
        extra_args: splitArgs(editPreset.extra_args),
      }
      : null;

  return (
    <div className="presets-workspace">
      <aside className="presets-list-panel">
        <div className="presets-list-head">
          <div className="section-title"><Save size={18} />预设列表</div>
          <button className="btn primary" onClick={onCreate}><Plus size={16} />新建</button>
          <div className="preset-vendor-filter" aria-label="预设厂商筛选">
            {presetVendorFilters.map((filter) => (
              <button
                key={filter.value}
                className={vendorFilter === filter.value ? 'active' : ''}
                type="button"
                onClick={() => setVendorFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        <div className="presets-list">
          {creatingVisible && (
            <button className="preset-list-item draft active" onClick={onCreate}>
              <span>
                <strong>{newPreset.name || '新建预设'}</strong>
                <small>新的转码参数</small>
              </span>
              <b>{encoderKindLabel(newPreset.encoder)}</b>
            </button>
          )}
          {filteredPresets.map((preset) => {
            const active = selectedPreset?.name === preset.name;
            return (
              <button key={preset.name} className={`preset-list-item ${active ? 'active' : ''}`} onClick={() => onSelect(preset)}>
                <span>
                  <strong>{preset.name}</strong>
                  <small>{preset.encoder} · CRF {preset.crf} · Preset {presetDisplayValue(preset.encoder, preset.preset)}</small>
                </span>
                <span className="preset-list-badges">
                  {preset.builtin && <b className="builtin">内置</b>}
                  <b>{encoderKindLabel(preset.encoder)}</b>
                </span>
              </button>
            );
          })}
          {!filteredPresets.length && !creatingVisible && <div className="empty-state compact">暂无该分类预设</div>}
        </div>
      </aside>

      <section className="preset-editor-panel">
        {!previewPreset ? (
          <div className="preset-empty">
            <Save size={28} />
            <span>选择左侧预设或新建一个预设</span>
          </div>
        ) : (
          <>
            <div className="preset-editor-head">
              <div className="min-w-0">
                <h3>{creating ? '新建预设' : selectedPreset?.name}</h3>
                <p>{creating ? '保存一组常用转码参数' : selectedPreset?.builtin ? '内置预设，可另存覆盖或重置' : '自定义预设，可直接编辑保存'}</p>
              </div>
              <div className="preset-editor-actions">
                <button className="btn" onClick={onCancel}><Pencil size={16} />编辑</button>
                {!creating && selectedPreset && (
                  selectedPreset.builtin
                    ? <button className="btn" onClick={() => onReset(selectedPreset)}><RefreshCw size={16} />重置</button>
                    : <button className="btn danger" onClick={() => onDelete(selectedPreset)}><Trash2 size={16} />删除</button>
                )}
                <button
                  className="btn primary"
                  disabled={creating ? !newPreset.name.trim() : !selectedPreset}
                  onClick={() => {
                    if (creating) {
                      onSaveNew();
                      return;
                    }
                    if (selectedPreset) onSave({ ...selectedPreset, ...editPreset, extra_args: splitArgs(editPreset.extra_args) });
                  }}
                >
                  <Save size={16} />保存
                </button>
              </div>
            </div>

            <div className="preset-editor-body">
              <div className="preset-form-grid">
                {creating && (
                  <label className="field span-2">
                    <span>预设名称</span>
                    <input value={newPreset.name} onChange={(event) => onNewChange((old) => ({ ...old, name: event.target.value }))} placeholder="例如：高压缩 AV1" />
                  </label>
                )}
                <label className="field">
                  <span>编码器</span>
                  <select
                    value={creating ? newPreset.encoder : editPreset.encoder}
                    onChange={(event) => {
                      if (creating) onNewChange((old) => ({ ...old, encoder: event.target.value }));
                      else onEditChange((old) => ({ ...old, encoder: event.target.value }));
                    }}
                  >
                    {availableEncoders.map((encoder) => <option key={encoder.name} value={encoder.name}>{encoder.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>输出格式</span>
                  <select
                    value={creating ? newPreset.output_ext : selectedPreset?.output_ext || 'auto'}
                    disabled={!creating}
                    onChange={(event) => onNewChange((old) => ({ ...old, output_ext: event.target.value }))}
                  >
                    <option value="auto">自动</option>
                    <option value=".mkv">.mkv</option>
                    <option value=".mp4">.mp4</option>
                    <option value=".webm">.webm</option>
                  </select>
                </label>
                <label className="field">
                  <span>CRF</span>
                  <input
                    type="number"
                    value={creating ? newPreset.crf : editPreset.crf}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (creating) onNewChange((old) => ({ ...old, crf: value }));
                      else onEditChange((old) => ({ ...old, crf: value }));
                    }}
                  />
                </label>
                <label className="field">
                  <span>Preset{previewPreset?.encoder === 'av1_qsv' ? `: ${presetDisplayValue(previewPreset.encoder, creating ? newPreset.preset : editPreset.preset)}` : ''}</span>
                  <input
                    value={creating ? newPreset.preset : editPreset.preset}
                    onChange={(event) => {
                      if (creating) onNewChange((old) => ({ ...old, preset: event.target.value }));
                      else onEditChange((old) => ({ ...old, preset: event.target.value }));
                    }}
                  />
                </label>
                <label className="field span-2">
                  <span>额外参数</span>
                  <input
                    value={creating ? newPreset.extra_args : editPreset.extra_args}
                    onChange={(event) => {
                      if (creating) onNewChange((old) => ({ ...old, extra_args: event.target.value }));
                      else onEditChange((old) => ({ ...old, extra_args: event.target.value }));
                    }}
                    placeholder="-svtav1-params lossless=1"
                  />
                </label>
              </div>

              <div className="preset-preview-card">
                <div className="preset-preview-title">FFmpeg 命令预览</div>
                <code>{presetCmd(previewPreset)}</code>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function encoderKindLabel(encoder: string) {
  if (encoder.includes('nvenc')) return 'NVIDIA';
  if (encoder.includes('qsv')) return 'INTEL';
  if (encoder.includes('amf')) return 'AMD';
  return 'CPU';
}

function presetVendor(encoder: string): PresetVendorFilter {
  if (encoder.includes('nvenc')) return 'nvidia';
  if (encoder.includes('qsv')) return 'intel';
  if (encoder.includes('amf')) return 'amd';
  return 'cpu';
}

const leaderboardEncoderOrder = ['libsvtav1', 'libaom-av1', 'librav1e', 'av1_qsv', 'av1_nvenc'];

function sortEncoders(encoders: string[]) {
  return [...encoders].sort(compareEncoders);
}

function compareEncoders(a: string, b: string) {
  return encoderRank(a) - encoderRank(b) || a.localeCompare(b);
}

function encoderRank(encoder: string) {
  const normalized = encoder.toLowerCase();
  const index = leaderboardEncoderOrder.findIndex((item) => normalized === item || normalized.includes(item.replace('lib', '').replace('-', '')));
  if (index >= 0) return index;
  if (normalized.includes('svt')) return 0;
  if (normalized.includes('aom')) return 1;
  if (normalized.includes('rav1e')) return 2;
  if (normalized.includes('qsv')) return 3;
  if (normalized.includes('nvenc')) return 4;
  return leaderboardEncoderOrder.length;
}

function bucketTasks(tasks: TaskInfo[], days: number, getValue: (task: TaskInfo) => number) {
  const buckets = Array.from({ length: days }, () => 0);
  const today = startOfDay(new Date()).getTime();
  for (const task of tasks) {
    const createdAt = new Date(task.created_at);
    if (Number.isNaN(createdAt.getTime())) continue;
    const diff = Math.floor((today - startOfDay(createdAt).getTime()) / 86400000);
    if (diff >= 0 && diff < days) buckets[days - 1 - diff] += getValue(task);
  }
  return buckets;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function taskFileCount(task: TaskInfo) {
  return task.total_files || task.request?.files?.length || 1;
}

function estimateSavedBytes(task: TaskInfo, fileSizes: Map<string, number>) {
  const inputBytes = (task.request?.files || []).reduce((sum, file) => sum + (fileSizes.get(file) || 0), 0);
  return inputBytes ? Math.round(inputBytes * 0.35) : 0;
}

function RangeField({ label, value, min, max, displayValue, onChange }: { label: string; value: number; min: number; max: number; displayValue?: string; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}: {displayValue || value}</span><input type="range" min={min} max={max} value={Math.min(max, Math.max(min, value))} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function SystemPage({
  sysInfo,
  tasks,
  hardware,
  hwLoading,
  onRefresh,
}: {
  sysInfo: SystemInfo | null;
  tasks: TaskInfo[];
  hardware: HardwareReport;
  hwLoading: boolean;
  onRefresh: () => void;
}) {
  const active = tasks.filter((task) => task.status === 'running').length;
  const queued = tasks.filter((task) => task.status === 'pending').length;
  const completed = tasks.filter((task) => task.status === 'done').length;
  const failed = tasks.filter((task) => task.status === 'failed').length;
  const availableEncoders = hardware.encoders.filter((encoder) => encoder.available);
  const gpuEncoders = availableEncoders.filter((encoder) => encoder.hw_type !== 'software');

  return (
    <section className="system-dashboard" aria-label="系统信息">
      <div className="system-dashboard-grid">
        <SystemInfoCard sysInfo={sysInfo} />
        <TaskStatisticsCard active={active} queued={queued} completed={completed} failed={failed} />
        <HardwareSummaryCard hardware={hardware} hwLoading={hwLoading} onRefresh={onRefresh} />
      </div>
      <div className="system-resource-panel">
        <div className="dashboard-card-head">
          <div className="section-title"><Activity size={18} />系统资源</div>
          <div className="resource-refresh">
            <span>更新</span>
            <select aria-label="系统资源刷新间隔" defaultValue="5s">
              <option value="5s">5s</option>
              <option value="10s">10s</option>
              <option value="30s">30s</option>
            </select>
          </div>
        </div>
        <div className="resource-strip">
          <ResourceMetric label="CPU 核心" value={String(sysInfo?.cores || 0)} tone="blue" detail={`${sysInfo?.threads || 0} 线程`} />
          <ResourceMetric label="内存容量" value={sysInfo?.memory || '未知'} tone="purple" detail="系统总内存" />
          <ResourceMetric label="硬件编码器" value={String(gpuEncoders.length)} tone="amber" detail={`总计 ${availableEncoders.length} 种可用方式`} />
        </div>
        <div className="resource-chart" aria-hidden="true">
          <div className="resource-axis y100">100</div>
          <div className="resource-axis y75">75</div>
          <div className="resource-axis y50">50</div>
          <div className="resource-axis y25">25</div>
          <div className="resource-axis y0">0</div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M0 93 L8 93 L16 92 L24 93 L32 92 L40 93 L48 92 L56 93 L64 92 L72 93 L80 92 L88 92 L100 93" />
          </svg>
        </div>
      </div>
    </section>
  );
}

function SystemInfoCard({ sysInfo }: { sysInfo: SystemInfo | null }) {
  return (
    <div className="dashboard-card system-info-card">
      <div className="dashboard-card-head">
        <div className="section-title"><Cpu size={18} />系统信息</div>
      </div>
      {sysInfo ? (
        <div className="system-info-list">
          <InfoRow icon={LayoutDashboard} label="系统" value={sysInfo.os || '未知'} />
          <InfoRow icon={Cpu} label="CPU" value={sysInfo.cpu || '未知'} badges={[`${sysInfo.cores || 0} 核`, `${sysInfo.threads || 0} 线程`]} />
          <InfoRow icon={HardDrive} label="内存" value={sysInfo.memory || '未知'} />
          <InfoRow icon={FileVideo} label="GPU" value={sysInfo.gpu || '未检测到'} />
        </div>
      ) : (
        <div className="empty-state compact">系统信息加载中</div>
      )}
    </div>
  );
}

function TaskStatisticsCard({ active, queued, completed, failed }: { active: number; queued: number; completed: number; failed: number }) {
  return (
    <div className="dashboard-card">
      <div className="dashboard-card-head">
        <div className="section-title"><BarChart3 size={18} />任务统计</div>
      </div>
      <div className="task-stat-grid">
        <TaskStat label="运行中" value={active} icon={Activity} />
        <TaskStat label="排队中" value={queued} icon={Clock3} />
        <TaskStat label="已完成" value={completed} icon={CircleCheck} />
        <TaskStat label="失败" value={failed} icon={CircleX} />
      </div>
    </div>
  );
}

function HardwareSummaryCard({ hardware, hwLoading, onRefresh }: { hardware: HardwareReport; hwLoading: boolean; onRefresh: () => void }) {
  const vendors = ['nvidia', 'intel', 'amd'] as const;
  const available = hardware.encoders.filter((encoder) => encoder.available);
  const hardwareAvailable = available.filter((encoder) => encoder.hw_type !== 'software');
  const softwareAvailable = available.filter((encoder) => encoder.hw_type === 'software');
  const activeVendor = vendors.find((vendor) => hardwareAvailable.some((encoder) => encoder.hw_type === vendor)) || '';
  const decodeFormats = summarizeCodecBadges(hardwareAvailable);
  const encodeFormats = summarizeCodecBadges(available);

  return (
    <div className="dashboard-card hardware-summary-card">
      <div className="dashboard-card-head hardware-head">
        <div className="section-title"><FileVideo size={18} />GPU 与硬件</div>
        <div className="vendor-tabs" aria-label="硬件厂商">
          {vendors.map((vendor) => (
            <span key={vendor} className={activeVendor === vendor ? 'active' : ''}>{vendor.toUpperCase()}</span>
          ))}
        </div>
      </div>
      <div className="hardware-state-row">
        <span className={`detect-pill ${hardwareAvailable.length ? 'ok' : ''}`}>{hwLoading ? '检测中' : hardwareAvailable.length ? '已检测' : '仅软件'}</span>
        <span className="profile-pill">{available.length} 种可用</span>
      </div>
      <CapabilityRow label="硬件方式" count={hardwareAvailable.length} badges={decodeFormats} muted={!hardwareAvailable.length} />
      <CapabilityRow label="编码方式" count={available.length} badges={encodeFormats} />
      {softwareAvailable.length > 0 && (
        <div className="software-codecs">
          {softwareAvailable.map((encoder) => <span key={encoder.name}>{encoder.label}</span>)}
        </div>
      )}
      <button className="link-button" type="button" onClick={onRefresh}>
        {hwLoading ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}重新检测
      </button>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, badges = [] }: { icon: typeof Activity; label: string; value: string; badges?: string[] }) {
  return (
    <div className="info-row">
      <Icon size={16} />
      <span>{label}</span>
      <div className="info-row-value">
        <strong title={value}>{value}</strong>
        {badges.length > 0 && (
          <div className="mini-badges">
            {badges.map((badge) => <em key={badge}>{badge}</em>)}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskStat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Activity }) {
  return (
    <div className="task-stat-tile">
      <span><Icon size={15} />{label}</span>
      <strong>{formatCompactNumber(value)}</strong>
    </div>
  );
}

function CapabilityRow({ label, count, badges, muted = false }: { label: string; count: number; badges: string[]; muted?: boolean }) {
  return (
    <div className={`capability-row ${muted ? 'muted' : ''}`}>
      <div className="capability-row-head">
        <span>{label}</span>
        <strong>{count}</strong>
      </div>
      <div className="codec-badges">
        {badges.map((badge) => <span key={badge}>{badge}</span>)}
        {!badges.length && <span>暂无硬件能力</span>}
      </div>
    </div>
  );
}

function ResourceMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'blue' | 'purple' | 'amber' }) {
  return (
    <div className={`resource-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function summarizeCodecBadges(encoders: EncoderInfo[]) {
  const labels = encoders.map((encoder) => encoder.name.includes('av1') ? 'AV1' : encoder.label.replace(/\s*\(CPU\)/, ''));
  const unique = Array.from(new Set(labels));
  return unique.length > 3 ? [...unique.slice(0, 3), `+${unique.length - 3}`] : unique;
}

function EncoderSupportPanel({
  title = '支持的转码方式',
  hardware,
  hwLoading,
  selectedEncoders = [],
  onRefresh,
  onToggle,
}: {
  title?: string;
  hardware: HardwareReport;
  hwLoading: boolean;
  selectedEncoders?: string[];
  onRefresh: () => void;
  onToggle?: (name: string) => void;
}) {
  const toggleEncoder = onToggle;
  const selectable = Boolean(toggleEncoder);
  return (
    <div className="info-panel">
      <div className="info-panel-head">
        <div>
          <div className="section-title"><FileVideo size={18} />{title}</div>
          {hardware.ffmpeg_version && <p>{hardware.ffmpeg_version}</p>}
        </div>
        <button className="btn" onClick={onRefresh}>{hwLoading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}重新检测</button>
      </div>
      <div className="encoder-support-grid">
        {hardware.encoders.map((encoder) => {
          const selected = selectedEncoders.includes(encoder.name);
          const className = `encoder-tile ${selected ? 'selected' : ''} ${!selectable ? 'readonly' : ''}`;
          if (!toggleEncoder) {
            return (
              <div key={encoder.name} className={className}>
                <Cpu size={19} /><span>{encoder.label}</span><code>{encoder.name}</code><small>{encoder.available ? '可用' : '不可用'}</small>
              </div>
            );
          }
          return (
            <button key={encoder.name} disabled={!encoder.available} className={className} onClick={() => toggleEncoder(encoder.name)}>
              <Cpu size={19} /><span>{encoder.label}</span><code>{encoder.name}</code><small>{encoder.available ? '可用' : '不可用'}</small>
            </button>
          );
        })}
        {!hardware.encoders.length && <div className="empty-state compact">暂无编码器信息</div>}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`chip ${active ? 'active' : ''}`} onClick={onClick}>{children}</button>;
}

function ResultsTable({ results }: { results: BenchmarkResult[] }) {
  if (!results.length) return <div className="empty-state compact">暂无结果</div>;
  return <table className="data-table"><thead><tr><th>编码器</th><th>FPS</th><th>耗时</th><th>大小</th><th>得分</th><th>状态</th></tr></thead><tbody>{results.map((row) => <tr key={row.encoder}><td>{row.label}</td><td>{row.error ? '-' : row.fps}</td><td>{row.elapsed}s</td><td>{row.error ? '-' : formatSize(row.output_size)}</td><td><b>{row.error ? '-' : row.score}</b></td><td><span className={`status ${row.error ? 'failed' : 'done'}`}>{row.error || 'OK'}</span></td></tr>)}</tbody></table>;
}

function useLocalStorage<T>(key: string, fallback: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value]);
  return [value, setValue];
}

function useClickOutside<T extends HTMLElement>(ref: React.RefObject<T | null>, active: boolean, onOutside: () => void) {
  useEffect(() => {
    if (!active) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (!node || node.contains(event.target as Node)) return;
      onOutside();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [active, onOutside, ref]);
}

async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await responseText(response));
  return response.json();
}

async function apiSend<T = unknown>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(await responseText(response));
  return response.json();
}

async function apiUpload<T = unknown>(url: string, body: FormData): Promise<T> {
  const response = await fetch(url, { method: 'POST', body });
  if (!response.ok) throw new Error(await responseText(response));
  return response.json();
}

async function downloadBlob(url: string, filename: string, expectedType?: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await responseText(response));
  const contentType = response.headers.get('content-type') || '';
  if (expectedType && !contentType.includes(expectedType)) {
    throw new Error('后端没有返回报告文件，请确认服务已重启到最新版本');
  }
  const blob = await response.blob();
  const objectURL = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectURL;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
}

async function responseText(response: Response) {
  try {
    const json = await response.json();
    return json.error || json.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

function errorMessage(error: unknown) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return '无法连接后端，请确认服务正在运行，并且已重启到最新版本';
  }
  return error instanceof Error ? error.message : '请求失败';
}

function statusText(status: string) {
  switch (status) {
    case 'uploading':
      return '上传中';
    case 'pending':
      return '等待中';
    case 'running':
      return '转码中';
    case 'done':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return status || '未知';
  }
}

function browserTitle(mode: 'watch' | 'replace' | 'output') {
  if (mode === 'replace') return '修改监控目录';
  if (mode === 'watch') return '选择监控目录';
  return '选择导出目录';
}

function browserSubtitle(mode: 'watch' | 'replace' | 'output') {
  if (mode === 'output') return '自定义输出';
  return '目录监控';
}

function formatSize(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value || 0)));
}

function formatDuration(seconds: number) {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds)}s`;
}

function pathToB64(path: string) {
  const bytes = new TextEncoder().encode(path);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function folderName(path: string) {
  return path.replace(/\/+$/, '').split('/').pop() || path || '/';
}

function pathBaseName(path: string) {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

function pathDir(path: string) {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (index <= 0) return index === 0 ? trimmed.slice(0, 1) : '';
  return trimmed.slice(0, index);
}

function pathExt(path: string) {
  const base = pathBaseName(path);
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index) : '';
}

function pathStem(path: string) {
  const base = pathBaseName(path);
  const ext = pathExt(base);
  return ext ? base.slice(0, -ext.length) : base;
}

function splitArgs(text: string) {
  return text.trim() ? text.trim().split(/\s+/) : [];
}

function flattenedOutputSuffix(root: string, file: string, suffix: string) {
  const rel = relativePath(root, file);
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 1) return suffix;
  const dirs = parts.slice(0, -1).map((part) => part.trim()).filter(Boolean);
  return dirs.length ? `_${dirs.join('_')}${suffix}` : suffix;
}

function joinPath(root: string, name: string) {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${separator}${name}`;
}

function relativePath(root: string, file: string) {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFile = file.replace(/\\/g, '/');
  if (normalizedFile.startsWith(`${normalizedRoot}/`)) return normalizedFile.slice(normalizedRoot.length + 1);
  return normalizedFile.split('/').pop() || normalizedFile;
}

function fileBelongsToWatchFolder(file: string, wf: WatchFolderResult) {
  return wf.files.some((entry) => entry.path === file);
}

function pathBelongsToFolder(path: string, folder: string) {
  const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFolder = folder.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedFolder) return Boolean(normalizedPath);
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function sameFolderPath(left: string, right: string) {
  return normalizeFolderPath(left) === normalizeFolderPath(right);
}

function normalizeFolderPath(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isActiveTranscodeTask(task: TaskInfo) {
  return task.status === 'running' || task.status === 'pending';
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value || 0));
}

function formatProgressPercent(value: number) {
  return `${clampPercent(value).toFixed(1)}%`;
}

function taskProgressPercent(task: TaskInfo) {
  const value = task.status === 'pending'
    ? 0
    : task.current_file_progress || task.progress || 0;
  return clampPercent(value);
}

function taskOverallProgressPercent(task: TaskInfo) {
  const value = task.status === 'pending' ? 0 : task.progress || 0;
  return clampPercent(value);
}

function makeResourcePoints(value: number) {
  const current = Math.max(0, Math.min(100, value || 0));
  return [current * 0.74, current * 0.86, current * 0.79, current * 0.93, current * 0.88, current];
}

function taskTouchesFolder(task: TaskInfo, folder: string) {
  if (task.current_file && pathBelongsToFolder(task.current_file, folder)) return true;
  return Boolean(task.request?.files?.some((file) => pathBelongsToFolder(file, folder)));
}

function managedFolderPresetLabel(tasks: TaskInfo[], presets: Preset[], folder: string, folderPresetName?: string, activeTaskID?: string) {
  const folderPreset = presets.find((item) => item.name === folderPresetName);
  if (folderPreset) return presetSummaryLabel(folderPreset);
  if (!folder) return '';
  const related = tasks.find((task) => activeTaskID && task.task_id === activeTaskID)
    || tasks.find((task) => taskTouchesFolder(task, folder) && (task.status === 'running' || task.status === 'pending'))
    || tasks.find((task) => taskTouchesFolder(task, folder) && task.status === 'done')
    || tasks.find((task) => taskTouchesFolder(task, folder));
  const request = related?.request;
  if (!request?.encoder) return '';
  const crf = Number(request.crf ?? 0);
  const preset = request.preset ?? '';
  const matchedPreset = presets.find((item) => {
    const sameArgs = JSON.stringify(item.extra_args || []) === JSON.stringify(request.extra_args || []);
    return item.encoder === request.encoder
      && Number(item.crf) === crf
      && String(item.preset) === String(preset)
      && (item.output_ext || 'auto') === (request.output_ext || 'auto')
      && sameArgs;
  });
  const name = matchedPreset?.name || '自定义';
  return `${name} · ${request.encoder} · CRF ${crf} · Preset ${presetDisplayValue(request.encoder, preset)}`;
}

function folderPresetLabel(folder: WatchFolder, presets: Preset[], globalForm: TranscodeForm) {
  const preset = presets.find((item) => item.name === folder.preset_name);
  if (preset) return presetSummaryLabel(preset);
  const globalPresetName = globalPresetNameForForm(presets, globalForm);
  return `全局设置 · ${globalPresetName} · ${globalForm.encoder} · CRF ${globalForm.crf} · Preset ${presetDisplayValue(globalForm.encoder, globalForm.preset)}`;
}

function presetSummaryLabel(preset: Preset) {
  return `${preset.name} · ${preset.encoder} · CRF ${preset.crf} · Preset ${presetDisplayValue(preset.encoder, preset.preset)}`;
}

function globalPresetNameForForm(presets: Preset[], form: TranscodeForm) {
  const normalized = normalizedTranscodeForm(form);
  const matched = presets.find((preset) => {
    const sameArgs = JSON.stringify(preset.extra_args || []) === JSON.stringify(normalized.extra_args || []);
    return preset.encoder === normalized.encoder
      && Number(preset.crf) === Number(normalized.crf)
      && String(normalizedPresetValue(preset.encoder, preset.preset)) === String(normalized.preset)
      && sameArgs;
  });
  return matched?.name || '自定义';
}

function transcodeRequestForFolder(folder: WatchFolder | undefined, presets: Preset[], globalForm: TranscodeForm): TaskRequest {
  const preset = folder?.preset_name ? presets.find((item) => item.name === folder.preset_name) : null;
  if (!preset) return normalizedTranscodeForm(globalForm);
  return {
    encoder: preset.encoder,
    crf: preset.crf,
    preset: normalizedPresetValue(preset.encoder, preset.preset),
    output_ext: globalForm.output_ext || 'auto',
    auto_mp4: globalForm.auto_mp4 !== false,
    suffix: globalForm.suffix,
    suffix_enabled: globalForm.suffix_enabled,
	    extra_args: preset.extra_args || [],
	    prefix: globalForm.prefix,
	    prefix_enabled: globalForm.prefix_enabled,
	  };
	}

function previewManagedTarget(item: ManagedFileItem, folder: WatchFolder | undefined, presets: Preset[], globalForm: TranscodeForm): ManagedFileSide {
  if (!folder || item.target.exists || item.status === 'running') return item.target;
  const targetPath = previewOutputPath(item.source.path, folder, presets, globalForm, isAV1CodecName(item.source.meta?.video_codec));
  if (!targetPath) return item.target;
  const name = pathBaseName(targetPath);
  return {
    ...item.target,
    name,
    path: targetPath,
    relative_path: name,
  };
}

function previewOutputPath(sourcePath: string, folder: WatchFolder, presets: Preset[], globalForm: TranscodeForm, isAV1Source: boolean) {
  const outputDest = normalizedOutputDest(folder);
  if (!outputDest) return '';

  const request = transcodeRequestForFolder(folder, presets, globalForm);
  const copyAV1 = folder.copy_av1 !== false && isAV1Source;
  const sourceExt = pathExt(sourcePath);
  let ext = sourceExt;
  if (!copyAV1 && request.output_ext && request.output_ext !== 'auto') {
    ext = request.output_ext;
  }
  if (!copyAV1 && request.auto_mp4 !== false && incompatibleAV1OutputExts.has(ext.toLowerCase())) {
    ext = '.mp4';
  }
  if (!ext) ext = '.mkv';

  const prefix = copyAV1 || request.prefix_enabled === false ? '' : request.prefix || '';
  const baseSuffix = copyAV1 || request.suffix_enabled === false ? '' : request.suffix || '_av1';
  const suffix = copyAV1
    ? ''
    : outputDest === 'subfolder' || outputDest === 'custom'
      ? flattenedOutputSuffix(folder.path, sourcePath, baseSuffix)
      : baseSuffix;
  const stem = pathStem(sourcePath);
  const outputDir = outputDest === 'subfolder'
    ? joinPath(folder.path, 'AV1')
    : outputDest === 'custom'
      ? folder.output_dir
      : pathDir(sourcePath);
  if (!outputDir) return '';
  return joinPath(outputDir, `${prefix}${stem}${suffix}${ext}`);
}

function groupFilesByTranscodeSettings(files: string[], watchFolders: WatchFolderResult[], presets: Preset[], globalForm: TranscodeForm) {
  const groups = new Map<string, { request: TaskRequest; files: string[] }>();
  for (const file of files) {
    const wf = watchFolders.find((item) => fileBelongsToWatchFolder(file, item));
    const request = transcodeRequestForFolder(wf?.folder, presets, globalForm);
    const key = JSON.stringify({
      encoder: request.encoder,
      crf: request.crf,
      preset: request.preset,
      output_ext: request.output_ext,
      auto_mp4: request.auto_mp4 !== false,
      extra_args: request.extra_args || [],
    });
    const group = groups.get(key) || { request, files: [] };
    group.files.push(file);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function managedStatusLabel(status: ManagedStatus) {
  if (status === 'keep') return '保持不动';
  if (status === 'add') return '转码新增';
  if (status === 'running') return '处理中';
  return '强制转码';
}

function mediaTags(meta?: ManagedFileMeta) {
  if (!meta) return [];
  const tags: { label: string; tone: string }[] = [];
  if (meta.video_codec) tags.push({ label: meta.video_codec.toUpperCase(), tone: 'video' });
  if (meta.audio_codec) tags.push({ label: meta.audio_codec.toUpperCase(), tone: 'audio' });
  if (meta.channels) tags.push({ label: `${meta.channels} 声道`, tone: 'channel' });
  if (meta.resolution) tags.push({ label: meta.resolution, tone: 'resolution' });
  if (meta.frame_rate) tags.push({ label: meta.frame_rate, tone: 'frame' });
  if (meta.bit_depth) tags.push({ label: `${meta.bit_depth}bit`, tone: 'depth' });
  if (meta.bitrate) tags.push({ label: formatBitrate(meta.bitrate), tone: 'bitrate' });
  return tags;
}

function isAV1CodecName(codec?: string) {
  const value = (codec || '').trim().toLowerCase();
  return value === 'av1' || value === 'libsvtav1' || value === 'libaom-av1' || value === 'librav1e';
}

function reclassifyManagedAV1Item(item: ManagedFileItem, copyAV1: boolean): ManagedFileItem {
  if (item.status === 'running' || !isAV1CodecName(item.source.meta?.video_codec)) return item;
  let next: ManagedFileItem;
  if (!copyAV1) {
    next = { ...item, status: 'keep', message: '源文件已是 AV1' };
  } else if (!item.target.path) {
    next = { ...item, status: 'keep', message: '源文件已是 AV1，尚未设置复制目标' };
  } else if (!item.target.exists) {
    next = { ...item, status: 'add', message: '源文件已是 AV1，将直接复制' };
  } else {
    next = { ...item, status: 'keep', message: 'AV1 副本已存在' };
  }
  if (item.target.exists && item.target.meta?.probe_failed) {
    return { ...next, status: 'force', message: '目标文件无法识别，可能已损坏' };
  }
  return next;
}

function formatBitrate(bitsPerSecond: number) {
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
  if (bitsPerSecond >= 1_000) return `${Math.round(bitsPerSecond / 1_000)} kbps`;
  return `${bitsPerSecond} bps`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function presetDisplayValue(encoder: string, preset: number | string) {
  if (encoder !== 'av1_qsv') return String(preset);
  const index = Number(preset);
  if (!Number.isInteger(index) || index < 0 || index >= qsvPresetLabels.length) return String(preset);
  return `${index} ${qsvPresetLabels[index]}`;
}

function qsvPresetValue(preset: number | string) {
  const text = String(preset).trim().toLowerCase();
  const index = qsvPresetLabels.indexOf(text);
  if (index >= 0) return String(index);
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return String(clamp(Math.trunc(numeric), 0, qsvPresetLabels.length - 1));
  return String(preset);
}

function normalizedPresetValue(encoder: string, preset: number | string) {
  if (encoder !== 'av1_qsv') return preset;
  return qsvPresetValue(preset);
}

function normalizedPreset<T extends Pick<Preset, 'encoder' | 'preset'>>(preset: T): T {
  return { ...preset, preset: normalizedPresetValue(preset.encoder, preset.preset) };
}

function normalizedTranscodeForm(form: TranscodeForm): TranscodeForm {
  return {
    ...defaultForm,
    ...form,
    prefix: form.prefix ?? '',
    prefix_enabled: form.prefix_enabled === true,
    suffix: form.suffix ?? defaultForm.suffix,
    suffix_enabled: form.suffix_enabled !== false,
    auto_mp4: form.auto_mp4 !== false,
    extra_args: form.extra_args || [],
    preset: normalizedPresetValue(form.encoder, form.preset),
  };
}

function presetToFormPatch(preset: Preset, fallbackOutputExt: string): Partial<TranscodeForm> {
  return {
    encoder: preset.encoder,
    crf: preset.crf,
    preset: normalizedPresetValue(preset.encoder, preset.preset),
    output_ext: fallbackOutputExt || 'auto',
    extra_args: preset.extra_args || [],
  };
}

function clamp(value: number, minValue: number, maxValue: number) {
  return Math.min(Math.max(value, minValue), maxValue);
}

function presetSummaryLine(preset: Preset) {
  const extraCount = preset.extra_args?.length || 0;
  return `${preset.encoder} · ${encoderKindLabel(preset.encoder)} · CRF ${preset.crf} · Preset ${presetDisplayValue(preset.encoder, preset.preset)} · ${preset.output_ext || 'auto'}${extraCount ? ` · 额外参数 ${extraCount} 项` : ''}`;
}

function presetCmd(p: Preset) {
  const parts = ['ffmpeg', '-hide_banner', '-y', '-i', '<input>', '-c:v', p.encoder];
  if (p.encoder === 'libsvtav1') parts.push('-crf', String(p.crf), '-preset', String(p.preset));
  else if (p.encoder === 'libaom-av1') parts.push('-crf', String(p.crf), '-cpu-used', String(p.preset));
  else if (p.encoder === 'librav1e') parts.push('-qp', String(p.crf), '-speed', String(p.preset));
  else if (p.encoder === 'av1_nvenc') parts.push('-cq', String(p.crf), '-preset', 'p5');
  else if (p.encoder === 'av1_qsv') parts.push('-global_quality', String(p.crf), '-preset', qsvPresetValue(p.preset));
  else if (p.encoder === 'av1_amf') parts.push('-quality', String(p.crf), '-usage', 'transcoding');
  parts.push('-c:a', 'copy', ...(p.extra_args || []), '<output>');
  return parts.join(' ');
}

function groupBy<T>(items: T[], getKey: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    map.set(key, [...(map.get(key) || []), item]);
  }
  return [...map.entries()];
}

createRoot(document.getElementById('root')!).render(<App />);
