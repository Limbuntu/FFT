import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock3,
  CloudUpload,
  Cpu,
  Download,
  FileDown,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Gauge,
  HardDrive,
  LayoutDashboard,
  Loader2,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Save,
  Square,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import './styles.css';

type Tab = 'console' | 'online' | 'transcode' | 'benchmark' | 'presets' | 'system';
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
};

type WatchFolderResult = {
  folder: WatchFolder;
  files: FileEntry[];
};

type TranscodeForm = {
  encoder: string;
  crf: number;
  preset: number | string;
  suffix: string;
  output_ext: string;
};

type TaskInfo = {
  task_id: string;
  request?: {
    files?: string[];
  };
  status: string;
  progress: number;
  speed: string;
  eta: string;
  eta_seconds: number;
  current_file: string;
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
const defaultForm: TranscodeForm = { encoder: 'libsvtav1', crf: 28, preset: 8, suffix: '_av1', output_ext: 'auto' };
const navItems: { id: Tab; label: string; description: string; icon: typeof Activity }[] = [
  { id: 'console', label: '控制台', description: '查看处理概览和运行状态', icon: LayoutDashboard },
  { id: 'online', label: '在线调用', description: '拖拽上传文件并在浏览器下载转码结果', icon: CloudUpload },
  { id: 'transcode', label: '转码', description: '监控目录、选择文件并管理转码任务', icon: FileVideo },
  { id: 'benchmark', label: '跑分', description: '测试编码器性能并查看本机记录', icon: BarChart3 },
  { id: 'presets', label: '预设', description: '维护常用编码参数和输出格式', icon: Save },
  { id: 'system', label: '系统信息', description: '查看硬件信息和支持的转码方式', icon: Cpu },
];

function App() {
  const [tab, setTab] = useState<Tab>('console');
  const [theme, setTheme] = useLocalStorage<Theme>('fft_theme', 'light');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const [watchFolders, setWatchFolders] = useState<WatchFolderResult[]>([]);
  const [wfLoading, setWfLoading] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState('');
  const [selectedFiles, setSelectedFiles] = useLocalStorage<string[]>('fft_selected_files', []);
  const [autoTranscode, setAutoTranscode] = useLocalStorage('fft_auto_transcode', true);
  const [fileBrowser, setFileBrowser] = useState<FileBrowser>(emptyBrowser);
  const [browserMode, setBrowserMode] = useState<'watch' | 'output' | null>(null);
  const outputFolderRef = useRef<string>('');
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
  const allFiles = useMemo(() => watchFolders.flatMap((wf) => wf.files), [watchFolders]);
  const browserFolders = useMemo(() => fileBrowser.entries.filter((entry) => entry.is_dir), [fileBrowser.entries]);
  const selectedSet = useMemo(() => new Set(selectedFiles), [selectedFiles]);
  const allSelected = allFiles.length > 0 && allFiles.every((file) => selectedSet.has(file.path));
  const onlineTaskIds = useMemo(() => new Set(onlineJobs.map((job) => job.task_id).filter(Boolean) as string[]), [onlineJobs]);
  const onlineTasks = useMemo(() => tasks.filter((task) => onlineTaskIds.has(task.task_id)), [onlineTaskIds, tasks]);

  const loadWatchFolders = useCallback(
    async (isInit = false) => {
      setWfLoading(true);
      try {
        const data = await apiGet<WatchFolderResult[]>('/api/watchfolders');
        setWatchFolders(data);
        const currentPaths = new Set(data.flatMap((wf) => wf.files.map((file) => file.path)));
        if (isInit) {
          knownFilePaths.current = currentPaths;
          setSelectedFiles((old) => (old.length ? old : [...currentPaths]));
          return;
        }
        const newFiles = [...currentPaths].filter((path) => !knownFilePaths.current.has(path));
        if (newFiles.length) {
          showToast(`发现 ${newFiles.length} 个新文件`, 'info');
          setSelectedFiles((old) => Array.from(new Set([...old, ...newFiles])));
          if (autoTranscode) {
            void startTranscodeFor(newFiles);
          }
        }
        knownFilePaths.current = currentPaths;
      } catch (error) {
        showToast(errorMessage(error), 'error');
      } finally {
        setWfLoading(false);
      }
    },
    [autoTranscode, setSelectedFiles, showToast],
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

  useEffect(() => {
    void loadWatchFolders(true);
    void detectHardware(false);
    void refreshTasks();
    void loadPresets();
    void loadBenchHistory();
    void apiGet<SystemInfo>('/api/sysinfo').then(setSysInfo).catch(() => undefined);
    void apiGet<LeaderboardItem[]>('/api/leaderboard').then((rows) => setLeaderboard(rows.sort((a, b) => b.score - a.score))).catch(() => undefined);
  }, [detectHardware, loadBenchHistory, loadPresets, loadWatchFolders, refreshTasks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (watchFolders.length) void loadWatchFolders(false);
    }, 10000);
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

  async function browseTo(path: string) {
    setFileBrowser(await apiGet<FileBrowser>(`/api/files?path=${encodeURIComponent(path)}`));
  }

  async function addWatchFolder(path = newFolderPath) {
    if (!path) return;
    await apiSend('/api/watchfolders', { path });
    setNewFolderPath('');
    await loadWatchFolders(false);
  }

  async function removeWatchFolder(path: string) {
    await apiSend(`/api/watchfolders/${pathToB64(path)}`, undefined, 'DELETE');
    setSelectedFiles((old) => old.filter((file) => !watchFolders.find((wf) => wf.folder.path === path)?.files.some((f) => f.path === file)));
    await loadWatchFolders(false);
  }

  async function updateFolder(folderPath: string, patch: Partial<Pick<WatchFolder, 'output_dest' | 'output_dir'>>) {
    await apiSend(`/api/watchfolders/${pathToB64(folderPath)}`, patch, 'PATCH');
    setWatchFolders((items) =>
      items.map((wf) => (wf.folder.path === folderPath ? { ...wf, folder: { ...wf.folder, ...patch } } : wf)),
    );
  }

  function buildFileOutputs(files: string[]) {
    const map: Record<string, { output_dest: string; output_dir: string }> = {};
    for (const file of files) {
      const wf = watchFolders.find((item) => item.files.some((entry) => entry.path === file));
      if (wf) {
        map[file] = { output_dest: wf.folder.output_dest || 'beside', output_dir: wf.folder.output_dir || '' };
      }
    }
    return map;
  }

  async function startTranscodeFor(files: string[]) {
    await apiSend('/api/transcode', { ...form, files, file_outputs: buildFileOutputs(files) });
    showToast(`已提交 ${files.length} 个文件转码`, 'info');
    await refreshTasks();
  }

  async function uploadOnlineFiles(files: File[]) {
    if (!files.length) return;
    for (const file of files) {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setOnlineJobs((jobs) => [{ id, name: file.name, size: file.size, status: 'uploading', progress: 0, message: '上传中' }, ...jobs]);
      try {
        const body = new FormData();
        body.append('file', file);
        body.append('encoder', form.encoder);
        body.append('crf', String(form.crf));
        body.append('preset', String(form.preset));
        body.append('suffix', form.suffix);
        body.append('output_ext', form.output_ext);
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
    const payload = preset ?? { ...newPreset, extra_args: splitArgs(newPreset.extra_args), output_ext: newPreset.output_ext || 'auto', builtin: false };
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
    return groupBy(rows, (row) => row.encoder).map(([encoder, items]) => ({
      encoder,
      items: items.sort((a, b) => b.score - a.score),
    }));
  }, [benchHistory, lbEncoder, leaderboard, sysInfo]);

  const lbEncoders = useMemo(() => Array.from(new Set(leaderboard.map((row) => row.encoder))), [leaderboard]);
  const isDark = theme === 'dark';

  return (
    <div className="app-root">
      <div className="fixed right-4 top-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>{toast.message}</div>
        ))}
      </div>

      <div className="app-shell">
        <aside className="app-sidebar">
          <div className="sidebar-brand">
            <div className="brand-mark"><Activity size={19} /></div>
            <div>
              <h1>FFT</h1>
              <p>FFmpeg AV1 Transcoder</p>
            </div>
          </div>

          <nav className="sidebar-nav" aria-label="主导航">
            <div className="sidebar-nav-label">导航</div>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={`sidebar-nav-item ${tab === item.id ? 'active' : ''}`} aria-label={item.label} onClick={() => setTab(item.id)}>
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
              <span>FFT v1.0.0</span>
              <a className="sidebar-log-link" href="/api/logs/download"><Download size={13} />日志</a>
            </div>
          </div>
        </aside>

        <div className="app-content">
          <header className="app-topbar">
            <button className="theme-toggle" aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'} title={isDark ? '浅色模式' : '深色模式'} onClick={() => setTheme(isDark ? 'light' : 'dark')}>
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
              <span>{isDark ? '浅色' : '深色'}</span>
            </button>
          </header>

          <main className={`app-main ${tab === 'transcode' ? 'workspace-grid' : tab === 'console' || tab === 'online' || tab === 'system' ? 'workspace-console' : 'workspace-single'}`}>
            {tab === 'console' && (
              <ConsolePage watchFolders={watchFolders} tasks={tasks} sysInfo={sysInfo} />
            )}

            {tab === 'online' && (
              <OnlinePage jobs={onlineJobs} tasks={onlineTasks} form={form} onUpload={(files) => void uploadOnlineFiles(files)} onDownloadReport={downloadTaskReport} />
            )}

            {tab === 'system' && (
              <SystemPage sysInfo={sysInfo} tasks={tasks} hardware={hardware} hwLoading={hwLoading} onRefresh={() => void detectHardware(true)} />
            )}

            {tab === 'transcode' && (
              <section className="panel workspace-panel">
                <div className="flex flex-wrap items-end gap-2 border-b border-line p-4">
                  <label className="field min-w-[260px] flex-1">
                    <span>监控文件夹</span>
                    <input value={newFolderPath} onChange={(event) => setNewFolderPath(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void addWatchFolder()} placeholder="输入目录路径，或浏览选择" />
                  </label>
                  <button className="btn primary" onClick={() => void addWatchFolder()} disabled={!newFolderPath}><Plus size={16} />添加</button>
                  <button className="btn" onClick={() => { setBrowserMode('watch'); void browseTo('/'); }}><FolderOpen size={16} />浏览</button>
                  <button className="icon-btn" title="刷新" onClick={() => void loadWatchFolders(false)}>{wfLoading ? <Loader2 className="animate-spin" size={17} /> : <RefreshCw size={17} />}</button>
                </div>

                <div className="grid gap-3 p-4 lg:grid-cols-2">
                  {watchFolders.map((wf) => (
                    <div key={wf.folder.path} className="item-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-semibold"><Folder size={17} />{wf.folder.label || wf.folder.path}</div>
                          <div className="text-muted mt-1 truncate text-xs" title={wf.folder.path}>{wf.folder.path}</div>
                          <div className="text-soft mt-1 text-xs">{wf.folder.file_count} 个视频 · {formatSize(wf.folder.total_size)}</div>
                        </div>
                        <button className="icon-btn danger" title="删除" onClick={() => void removeWatchFolder(wf.folder.path)}><Trash2 size={16} /></button>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                        <select value={wf.folder.output_dest} onChange={(event) => void updateFolder(wf.folder.path, { output_dest: event.target.value })}>
                          <option value="beside">源文件旁</option>
                          <option value="subfolder">av1 子目录</option>
                          <option value="custom">自定义目录</option>
                        </select>
                        <input value={wf.folder.output_dir || ''} disabled={wf.folder.output_dest !== 'custom'} onChange={(event) => void updateFolder(wf.folder.path, { output_dir: event.target.value })} placeholder="输出目录" />
                        <button className="icon-btn" title="选择输出目录" disabled={wf.folder.output_dest !== 'custom'} onClick={() => { outputFolderRef.current = wf.folder.path; setBrowserMode('output'); void browseTo('/'); }}><FolderOpen size={16} /></button>
                      </div>
                    </div>
                  ))}
                  {!watchFolders.length && <div className="empty-state">尚未添加监控文件夹</div>}
                </div>

                <div className="border-t border-line">
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={allSelected} onChange={() => setSelectedFiles(allSelected ? [] : allFiles.map((file) => file.path))} />
                      全选
                    </label>
                    <span className="text-soft text-sm">已选 {selectedFiles.length} / {allFiles.length}</span>
                    <button className="btn primary ml-auto" disabled={!selectedFiles.length} onClick={() => void startTranscodeFor(selectedFiles)}><Play size={16} />开始转码</button>
                  </div>
                  <div className="max-h-[50vh] overflow-auto">
                    <table className="data-table">
                      <thead><tr><th></th><th>文件名</th><th>文件夹</th><th>大小</th></tr></thead>
                      <tbody>
                        {watchFolders.map((wf) => (
                          <React.Fragment key={wf.folder.path}>
                            {wf.files.length > 0 && (
                              <tr className="group-row">
                                <td><input type="checkbox" checked={wf.files.every((file) => selectedSet.has(file.path))} onChange={() => toggleFolderSelection(wf, selectedSet, setSelectedFiles)} /></td>
                                <td colSpan={3}>{wf.folder.label || wf.folder.path}</td>
                              </tr>
                            )}
                            {wf.files.map((file) => (
                              <tr key={file.path} onClick={() => toggleFile(file.path, setSelectedFiles)}>
                                <td><input type="checkbox" checked={selectedSet.has(file.path)} onChange={() => toggleFile(file.path, setSelectedFiles)} onClick={(event) => event.stopPropagation()} /></td>
                                <td className="font-medium">{file.name}</td>
                                <td className="text-muted">{wf.folder.label || wf.folder.path}</td>
                                <td>{formatSize(file.size)}</td>
                              </tr>
                            ))}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {tab !== 'console' && tab !== 'online' && tab !== 'system' && (
              <section className="panel workspace-panel">
          {tab === 'transcode' && (
            <div className="space-y-4 p-4">
              <div className="section-title"><Gauge size={18} />转码设置</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="field">
                  <span>编码器</span>
                  <select value={form.encoder} onChange={(event) => setForm((old) => ({ ...old, encoder: event.target.value }))}>
                    {availableEncoders.map((encoder) => <option key={encoder.name} value={encoder.name}>{encoder.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>预设</span>
                  <select value={selectedPreset} onChange={(event) => {
                    const name = event.target.value;
                    setSelectedPreset(name);
                    const preset = presets.find((item) => item.name === name);
                    if (preset) setForm((old) => ({ ...old, encoder: preset.encoder, crf: preset.crf, preset: preset.preset, output_ext: preset.output_ext || old.output_ext }));
                  }}>
                    <option value="">自定义</option>
                    {presets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
                  </select>
                </label>
              </div>
              <RangeField label="CRF" value={Number(form.crf)} min={0} max={63} onChange={(value) => setForm((old) => ({ ...old, crf: value }))} />
              <RangeField label="Preset" value={Number(form.preset)} min={0} max={13} onChange={(value) => setForm((old) => ({ ...old, preset: value }))} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="field"><span>输出后缀</span><input value={form.suffix} onChange={(event) => setForm((old) => ({ ...old, suffix: event.target.value }))} /></label>
                <label className="field"><span>输出格式</span><select value={form.output_ext} onChange={(event) => setForm((old) => ({ ...old, output_ext: event.target.value }))}><option value="auto">自动</option><option value=".mkv">.mkv</option><option value=".mp4">.mp4</option><option value=".webm">.webm</option></select></label>
              </div>
              <label className="switch-row"><input type="checkbox" checked={autoTranscode} onChange={(event) => setAutoTranscode(event.target.checked)} />新文件自动转码</label>

              <div className="flex items-center justify-between pt-2">
                <div className="section-title"><Activity size={18} />任务列表</div>
                {totalEta && <span className="text-muted text-xs">{totalEta}</span>}
              </div>
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div key={task.task_id} className="task-card">
                    <div className="flex items-center gap-2">
                      <code>{task.task_id}</code>
                      <span className={`status ${task.status}`}>{task.status}</span>
                      {task.eta && <span className="text-muted ml-auto text-xs">{task.eta}</span>}
                      {(task.status === 'running' || task.status === 'pending') && <button className="icon-btn" title="取消" onClick={() => void apiSend(`/api/transcode/${task.task_id}`, undefined, 'DELETE')}><Square size={15} /></button>}
                    </div>
                    {task.current_file && <div className="mt-2 text-sm">{task.total_files > 1 ? `${task.current_index + 1}/${task.total_files} ` : ''}{task.current_file}</div>}
                    {task.output_path && <div className="text-muted truncate text-xs" title={task.output_path}>输出: {task.output_path}</div>}
                    <div className="progress-track mt-2"><div className="progress-fill" style={{ width: `${task.progress || 0}%` }} /></div>
                    <div className="text-muted mt-1 text-xs">{task.progress || 0}% {task.speed ? `· ${task.speed}` : ''} {task.message}</div>
                    {task.status === 'done' && (
                      <div className="task-actions">
                        <button className="btn" type="button" onClick={() => void downloadTaskReport(task.task_id)}><FileText size={16} />PDF 报告</button>
                      </div>
                    )}
                  </div>
                ))}
                {!tasks.length && <div className="empty-state compact">暂无任务</div>}
              </div>
            </div>
          )}

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
                  <div className="flex flex-wrap gap-2"><Chip active={!lbEncoder} onClick={() => setLbEncoder('')}>全部</Chip>{lbEncoders.map((encoder) => <Chip key={encoder} active={lbEncoder === encoder} onClick={() => setLbEncoder(encoder)}>{encoder}</Chip>)}</div>
                  {filteredLeaderboard.map((group) => (
                    <div key={group.encoder}>
                      <h3 className="mb-2 font-semibold">{group.encoder}</h3>
                      <div className="space-y-2">
                        {group.items.map((row, index) => (
                          <div key={`${row.chip}-${index}`} className="grid grid-cols-[150px_1fr] items-center gap-3">
                            <div className="min-w-0 text-sm"><div className="truncate">{row.isMe ? row.note : row.chip}</div><div className="text-muted truncate text-xs">{row.isMe ? row.chip : row.note}</div></div>
                            <div className="score-track"><div className={row.isMe ? 'score-fill mine' : 'score-fill'} style={{ width: `${(row.score / group.items[0].score) * 100}%` }} /><span>{row.score}</span></div>
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
              presets={presets}
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
        <div className="modal folder-browser-modal">
          <div className="modal-card folder-browser-card" role="dialog" aria-modal="true" aria-label={browserMode === 'watch' ? '选择监控目录' : '选择导出目录'}>
            <div className="folder-browser-header">
              <div className="folder-browser-title">
                <span className="folder-browser-icon"><FolderOpen size={18} /></span>
                <div>
                  <h2>{browserMode === 'watch' ? '选择监控目录' : '选择导出目录'}</h2>
                  <p>{browserMode === 'watch' ? '监控文件夹' : '自定义输出'}</p>
                </div>
              </div>
              <button className="icon-btn" aria-label="关闭" onClick={() => setBrowserMode(null)}><X size={16} /></button>
            </div>
            <div className="folder-browser-pathbar">
              <button className="icon-btn" title="返回上级" aria-label="返回上级" disabled={!fileBrowser.parent} onClick={() => fileBrowser.parent && void browseTo(fileBrowser.parent)}><ChevronLeft size={16} /></button>
              <div className="folder-browser-path">
                <span>当前位置</span>
                <strong title={fileBrowser.current}>{fileBrowser.current}</strong>
              </div>
            </div>
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
                  if (browserMode === 'output') void updateFolder(outputFolderRef.current, { output_dir: fileBrowser.current });
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
type ResourceMode = 'cpu' | 'ram';

function ConsolePage({ watchFolders, tasks, sysInfo }: { watchFolders: WatchFolderResult[]; tasks: TaskInfo[]; sysInfo: SystemInfo | null }) {
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
  const resourceValue = resourceMode === 'cpu' ? '待采样' : (sysInfo?.memory || '未知');
  const resourceDetail = resourceMode === 'cpu'
    ? (sysInfo ? `${sysInfo.cores || 0} 核 / ${sysInfo.threads || 0} 线程` : '等待系统信息')
    : '系统内存容量';

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
          title={resourceMode === 'cpu' ? '处理器' : '内存'}
          value={resourceValue}
          detail={resourceDetail}
          tone="amber"
          icon={Cpu}
          points={resourceMode === 'cpu' ? [0, 0, 0, 0, 0, 0, 0] : [1, 1, 1, 1, 1, 1, 1]}
          toggle={{
            value: resourceMode,
            options: [
              { value: 'cpu', label: '处理器' },
              { value: 'ram', label: '内存' },
            ],
            onChange: (value) => setResourceMode(value as ResourceMode),
          }}
        />
      </div>

      <div className="files-overview">
        <div className="files-overview-head">
          <div className="files-overview-title">文件</div>
          <div className="file-status-strip">
            <StatusChip tone="running" icon={Activity} label="运行中" value={runningCount} />
            <StatusChip tone="upcoming" icon={Clock3} label="待处理" value={upcomingCount} />
            <StatusChip tone="finished" icon={CircleCheck} label="已完成" value={finishedCount} />
            <StatusChip tone="failed" icon={CircleX} label="失败" value={failedCount} />
          </div>
        </div>
      </div>
    </section>
  );
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
        {Icon && <div className="metric-icon"><Icon size={27} /></div>}
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

function OnlinePage({ jobs, tasks, form, onUpload, onDownloadReport }: { jobs: OnlineJob[]; tasks: TaskInfo[]; form: TranscodeForm; onUpload: (files: File[]) => void; onDownloadReport: (taskID?: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const taskByID = useMemo(() => new Map(tasks.map((task) => [task.task_id, task])), [tasks]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const acceptFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList || []).filter((file) => file.size > 0);
    if (files.length) onUpload(files);
  };

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
      </div>

      <div className="online-settings-strip">
        <span>当前参数</span>
        <b>{form.encoder}</b>
        <b>CRF {form.crf}</b>
        <b>Preset {String(form.preset)}</b>
        <b>{form.output_ext === 'auto' ? '自动格式' : form.output_ext}</b>
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
                <span className={`status ${status}`}>{statusText(status)}</span>
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
  const selectedPreset = presets.find((preset) => preset.name === editingPreset) ?? null;
  const creating = editingPreset === '__new__';
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
        </div>
        <div className="presets-list">
          {creating && (
            <button className="preset-list-item draft active" onClick={onCreate}>
              <span>
                <strong>{newPreset.name || '新建预设'}</strong>
                <small>新的转码参数</small>
              </span>
              <b>{encoderKindLabel(newPreset.encoder)}</b>
            </button>
          )}
          {presets.map((preset) => {
            const active = selectedPreset?.name === preset.name;
            return (
              <button key={preset.name} className={`preset-list-item ${active ? 'active' : ''}`} onClick={() => onSelect(preset)}>
                <span>
                  <strong>{preset.name}</strong>
                  <small>{preset.encoder} · CRF {preset.crf} · Preset {String(preset.preset)}</small>
                </span>
                <span className="preset-list-badges">
                  {preset.builtin && <b className="builtin">内置</b>}
                  <b>{encoderKindLabel(preset.encoder)}</b>
                </span>
              </button>
            );
          })}
          {!presets.length && !creating && <div className="empty-state compact">暂无预设</div>}
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
                <button className="btn" onClick={onCancel}><X size={16} />取消</button>
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
                  <span>Preset</span>
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
  if (encoder.includes('qsv')) return 'Intel';
  if (encoder.includes('amf')) return 'AMD';
  return 'CPU';
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

function RangeField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}: {value}</span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
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
  const activeVendor = vendors.find((vendor) => hardwareAvailable.some((encoder) => encoder.hw_type === vendor)) || vendors[0];
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

function toggleFile(path: string, setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>) {
  setSelectedFiles((old) => (old.includes(path) ? old.filter((item) => item !== path) : [...old, path]));
}

function toggleFolderSelection(wf: WatchFolderResult, selectedSet: Set<string>, setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>) {
  const paths = wf.files.map((file) => file.path);
  if (paths.every((path) => selectedSet.has(path))) {
    setSelectedFiles((old) => old.filter((path) => !paths.includes(path)));
  } else {
    setSelectedFiles((old) => Array.from(new Set([...old, ...paths])));
  }
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

function splitArgs(text: string) {
  return text.trim() ? text.trim().split(/\s+/) : [];
}

function presetCmd(p: Preset) {
  const parts = ['ffmpeg', '-hide_banner', '-y', '-i', '<input>', '-c:v', p.encoder];
  if (p.encoder === 'libsvtav1') parts.push('-crf', String(p.crf), '-preset', String(p.preset));
  else if (p.encoder === 'libaom-av1') parts.push('-crf', String(p.crf), '-cpu-used', String(p.preset));
  else if (p.encoder === 'librav1e') parts.push('-qp', String(p.crf), '-speed', String(p.preset));
  else if (p.encoder === 'av1_nvenc') parts.push('-cq', String(p.crf), '-preset', 'p5');
  else if (p.encoder === 'av1_qsv') parts.push('-global_quality', String(p.crf), '-preset', 'medium');
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
