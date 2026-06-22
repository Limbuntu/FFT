import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  BarChart3,
  Check,
  ChevronLeft,
  Cpu,
  Download,
  FileVideo,
  Folder,
  FolderOpen,
  Gauge,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import './styles.css';

type Tab = 'transcode' | 'benchmark' | 'presets';
type BenchView = 'leaderboard' | 'test' | 'history';

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

const emptyBrowser: FileBrowser = { current: '/', parent: null, entries: [] };
const defaultForm: TranscodeForm = { encoder: 'libsvtav1', crf: 28, preset: 8, suffix: '_av1', output_ext: 'auto' };
const navItems: { id: Tab; label: string; description: string; icon: typeof Activity }[] = [
  { id: 'transcode', label: '转码', description: '监控目录、选择文件并管理转码任务', icon: FileVideo },
  { id: 'benchmark', label: '跑分', description: '测试编码器性能并查看本机记录', icon: BarChart3 },
  { id: 'presets', label: '预设', description: '维护常用编码参数和输出格式', icon: Save },
];

function App() {
  const [tab, setTab] = useState<Tab>('transcode');
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
  const [newPreset, setNewPreset] = useState({ name: '', encoder: 'libsvtav1', crf: 28, preset: 8 });

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastSeq.current;
    setToasts((items) => [...items, { id, message, type }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 5000);
  }, []);

  const availableEncoders = useMemo(() => hardware.encoders.filter((encoder) => encoder.available), [hardware.encoders]);
  const allFiles = useMemo(() => watchFolders.flatMap((wf) => wf.files), [watchFolders]);
  const selectedSet = useMemo(() => new Set(selectedFiles), [selectedFiles]);
  const allSelected = allFiles.length > 0 && allFiles.every((file) => selectedSet.has(file.path));

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
    const payload = preset ?? { ...newPreset, extra_args: [], output_ext: 'auto', builtin: false };
    await apiSend('/api/presets', payload);
    setNewPreset({ name: '', encoder: form.encoder, crf: 28, preset: 8 });
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
  const activeNav = navItems.find((item) => item.id === tab) ?? navItems[0];

  return (
    <div className="min-h-screen bg-mist text-ink">
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
            <span>FFT v1.0.0</span>
            <a className="sidebar-log-link" href="/api/logs/download"><Download size={13} />下载日志</a>
          </div>
        </aside>

        <div className="app-content">
          <header className="app-topbar">
            <div>
              <h2>{activeNav.label}</h2>
              <p>{activeNav.description}</p>
            </div>
          </header>

          <main className={`app-main ${tab === 'transcode' ? 'workspace-grid' : 'workspace-single'}`}>
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
                          <div className="mt-1 truncate text-xs text-slate-500" title={wf.folder.path}>{wf.folder.path}</div>
                          <div className="mt-1 text-xs text-slate-600">{wf.folder.file_count} 个视频 · {formatSize(wf.folder.total_size)}</div>
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
                  {!watchFolders.length && <div className="rounded border border-dashed border-line p-8 text-center text-sm text-slate-500">尚未添加监控文件夹</div>}
                </div>

                <div className="border-t border-line">
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={allSelected} onChange={() => setSelectedFiles(allSelected ? [] : allFiles.map((file) => file.path))} />
                      全选
                    </label>
                    <span className="text-sm text-slate-600">已选 {selectedFiles.length} / {allFiles.length}</span>
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
                                <td className="text-slate-500">{wf.folder.label || wf.folder.path}</td>
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
                {totalEta && <span className="text-xs text-slate-500">{totalEta}</span>}
              </div>
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div key={task.task_id} className="task-card">
                    <div className="flex items-center gap-2">
                      <code>{task.task_id}</code>
                      <span className={`status ${task.status}`}>{task.status}</span>
                      {task.eta && <span className="ml-auto text-xs text-slate-500">{task.eta}</span>}
                      {(task.status === 'running' || task.status === 'pending') && <button className="icon-btn" title="取消" onClick={() => void apiSend(`/api/transcode/${task.task_id}`, undefined, 'DELETE')}><Square size={15} /></button>}
                    </div>
                    {task.current_file && <div className="mt-2 text-sm text-slate-700">{task.total_files > 1 ? `${task.current_index + 1}/${task.total_files} ` : ''}{task.current_file}</div>}
                    {task.output_path && <div className="truncate text-xs text-slate-500" title={task.output_path}>输出: {task.output_path}</div>}
                    <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-brand" style={{ width: `${task.progress || 0}%` }} /></div>
                    <div className="mt-1 text-xs text-slate-500">{task.progress || 0}% {task.speed ? `· ${task.speed}` : ''} {task.message}</div>
                  </div>
                ))}
                {!tasks.length && <div className="rounded border border-dashed border-line p-6 text-center text-sm text-slate-500">暂无任务</div>}
              </div>
            </div>
          )}

          {tab === 'benchmark' && (
            <div className="space-y-4 p-4">
              <div className="section-title"><BarChart3 size={18} />跑分测试</div>
              {sysInfo && <div className="item-card text-sm"><div><b>CPU:</b> {sysInfo.cpu} ({sysInfo.cores}核 / {sysInfo.threads}线程)</div><div><b>GPU:</b> {sysInfo.gpu}</div><div><b>内存:</b> {sysInfo.memory} · <b>系统:</b> {sysInfo.os}</div></div>}
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
                            <div className="min-w-0 text-sm"><div className="truncate">{row.isMe ? row.note : row.chip}</div><div className="truncate text-xs text-slate-500">{row.isMe ? row.chip : row.note}</div></div>
                            <div className="relative h-6 rounded bg-slate-200"><div className={row.isMe ? 'h-full rounded bg-brand' : 'h-full rounded bg-slate-400'} style={{ width: `${(row.score / group.items[0].score) * 100}%` }} /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold">{row.score}</span></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {benchView === 'test' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between"><span className="text-sm text-slate-500">{hardware.ffmpeg_version}</span><button className="btn" onClick={() => void detectHardware(true)}>{hwLoading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}重新检测</button></div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {hardware.encoders.map((encoder) => (
                      <button key={encoder.name} disabled={!encoder.available} className={`encoder-tile ${benchEncoders.includes(encoder.name) ? 'selected' : ''}`} onClick={() => setBenchEncoders((old) => old.includes(encoder.name) ? old.filter((name) => name !== encoder.name) : [...old, encoder.name])}>
                        <Cpu size={19} /><span>{encoder.label}</span><code>{encoder.name}</code><small>{encoder.available ? '可用' : '不可用'}</small>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2"><button className="btn primary" disabled={benchLoading} onClick={() => void runBenchmark()}><Play size={16} />开始跑分</button>{benchLoading && <button className="btn" onClick={() => { void apiSend('/api/benchmark/cancel', {}, 'POST'); setBenchLoading(false); }}><X size={16} />取消</button>}<span className="text-xs text-slate-500">{benchEncoders.length ? `已选 ${benchEncoders.length} 个编码器` : '未选择，将测试全部可用编码器'}</span></div>
                  {benchRoundInfo && <div className="rounded bg-blue-50 px-3 py-2 text-sm text-blue-800">{benchRoundInfo}</div>}
                  <ResultsTable results={benchResults} />
                </div>
              )}

              {benchView === 'history' && <ResultsTable results={benchHistory?.results || []} />}
            </div>
          )}

          {tab === 'presets' && (
            <div className="space-y-4 p-4">
              <div className="section-title"><Save size={18} />预设管理</div>
              <div className="space-y-3">
                {presets.map((preset) => (
                  <div key={preset.name} className="item-card">
                    <div className="flex items-center justify-between gap-2">
                      <div><b>{preset.name}</b>{preset.builtin && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">内置</span>}</div>
                      <div className="flex gap-2">
                        <button className="icon-btn" title="编辑" onClick={() => { setEditingPreset(preset.name); setEditPreset({ encoder: preset.encoder, crf: preset.crf, preset: preset.preset, extra_args: (preset.extra_args || []).join(' ') }); }}><Settings size={16} /></button>
                        {!preset.builtin && <button className="icon-btn danger" title="删除" onClick={() => void apiSend(`/api/presets/${encodeURIComponent(preset.name)}`, undefined, 'DELETE').then(loadPresets)}><Trash2 size={16} /></button>}
                        {preset.builtin && <button className="icon-btn" title="重置" onClick={() => void apiSend(`/api/presets/${encodeURIComponent(preset.name)}/reset`, {}, 'POST').then(loadPresets)}><RefreshCw size={16} /></button>}
                      </div>
                    </div>
                    {editingPreset === preset.name ? (
                      <div className="mt-3 grid gap-2">
                        <select value={editPreset.encoder} onChange={(event) => setEditPreset((old) => ({ ...old, encoder: event.target.value }))}>{availableEncoders.map((encoder) => <option key={encoder.name} value={encoder.name}>{encoder.label}</option>)}</select>
                        <div className="grid gap-2 sm:grid-cols-2"><input type="number" value={editPreset.crf} onChange={(event) => setEditPreset((old) => ({ ...old, crf: Number(event.target.value) }))} /><input value={editPreset.preset} onChange={(event) => setEditPreset((old) => ({ ...old, preset: event.target.value }))} /></div>
                        <input value={editPreset.extra_args} onChange={(event) => setEditPreset((old) => ({ ...old, extra_args: event.target.value }))} placeholder="-svtav1-params lossless=1" />
                        <div className="flex gap-2"><button className="btn primary" onClick={() => void savePreset({ ...preset, ...editPreset, extra_args: splitArgs(editPreset.extra_args) })}><Check size={16} />保存</button><button className="btn" onClick={() => setEditingPreset(null)}><X size={16} />取消</button></div>
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-slate-600">编码器: {preset.encoder} · CRF: {preset.crf} · Preset: {preset.preset}<code className="mt-2 block truncate rounded bg-slate-100 px-2 py-1 text-xs">{presetCmd(preset)}</code></div>
                    )}
                  </div>
                ))}
              </div>
              <div className="item-card">
                <div className="mb-3 font-semibold">新建预设</div>
                <div className="grid gap-2 sm:grid-cols-2"><input value={newPreset.name} onChange={(event) => setNewPreset((old) => ({ ...old, name: event.target.value }))} placeholder="名称" /><select value={newPreset.encoder} onChange={(event) => setNewPreset((old) => ({ ...old, encoder: event.target.value }))}>{availableEncoders.map((encoder) => <option key={encoder.name} value={encoder.name}>{encoder.label}</option>)}</select><input type="number" value={newPreset.crf} onChange={(event) => setNewPreset((old) => ({ ...old, crf: Number(event.target.value) }))} /><input type="number" value={newPreset.preset} onChange={(event) => setNewPreset((old) => ({ ...old, preset: Number(event.target.value) }))} /></div>
                <button className="btn primary mt-3" disabled={!newPreset.name} onClick={() => void savePreset()}><Save size={16} />保存预设</button>
              </div>
            </div>
          )}
        </section>
          </main>
        </div>
      </div>

      {browserMode && (
        <div className="modal">
          <div className="modal-card">
            <div className="flex items-center justify-between border-b border-line p-4">
              <h2 className="font-semibold">{browserMode === 'watch' ? '选择目录' : '选择导出目录'}</h2>
              <button className="icon-btn" onClick={() => setBrowserMode(null)}><X size={16} /></button>
            </div>
            <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-sm">
              <button className="icon-btn" disabled={!fileBrowser.parent} onClick={() => fileBrowser.parent && void browseTo(fileBrowser.parent)}><ChevronLeft size={16} /></button>
              <span className="truncate text-slate-600">{fileBrowser.current}</span>
            </div>
            <div className="max-h-[55vh] overflow-auto p-2">
              {fileBrowser.entries.filter((entry) => entry.is_dir).map((entry) => (
                <button key={entry.path} className="w-full rounded px-3 py-2 text-left hover:bg-slate-100" onClick={() => void browseTo(entry.path)}><Folder size={16} className="mr-2 inline" />{entry.name}</button>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-line p-4">
              <button className="btn" onClick={() => setBrowserMode(null)}>取消</button>
              <button className="btn primary" onClick={() => {
                if (browserMode === 'watch') void addWatchFolder(fileBrowser.current);
                if (browserMode === 'output') void updateFolder(outputFolderRef.current, { output_dir: fileBrowser.current });
                setBrowserMode(null);
              }}><Check size={16} />选择此目录</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RangeField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}: {value}</span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`chip ${active ? 'active' : ''}`} onClick={onClick}>{children}</button>;
}

function ResultsTable({ results }: { results: BenchmarkResult[] }) {
  if (!results.length) return <div className="rounded border border-dashed border-line p-6 text-center text-sm text-slate-500">暂无结果</div>;
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

async function responseText(response: Response) {
  try {
    const json = await response.json();
    return json.error || json.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败';
}

function formatSize(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
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
