const { createApp, ref, reactive, computed, onMounted, onUnmounted, watch } = Vue;

createApp({
    setup() {
        // ── Right panel tab ──
        const rightTab = ref('transcode');

        // ── Toast notifications ──
        const toasts = ref([]);
        let toastId = 0;

        function showToast(message, type = 'info') {
            const id = ++toastId;
            toasts.value.push({ id, message, type });
            setTimeout(() => {
                toasts.value = toasts.value.filter(t => t.id !== id);
            }, 5000);
        }

        // ── Watch Folders ──
        const watchFolders = ref([]);
        const wfLoading = ref(false);
        const newFolderPath = ref('');
        const showBrowseDialog = ref(false);
        const selectedFiles = ref([]);
        const autoTranscode = ref(localStorage.getItem('fft_auto_transcode') !== 'false');
        let knownFilePaths = new Set();
        let pollTimer = null;

        watch(autoTranscode, (v) => localStorage.setItem('fft_auto_transcode', v));

        const fileBrowser = reactive({ current: '/', parent: null, entries: [] });

        const pathSegments = computed(() => {
            const parts = fileBrowser.current.split('/').filter(Boolean);
            return parts.map((name, i) => ({
                name,
                path: '/' + parts.slice(0, i + 1).join('/'),
            }));
        });

        const allWatchFiles = computed(() =>
            watchFolders.value.flatMap(wf => wf.files)
        );

        const allWatchFilesSelected = computed(() =>
            allWatchFiles.value.length > 0 &&
            allWatchFiles.value.every(f => selectedFiles.value.includes(f.path))
        );

        function selectAllFiles() {
            selectedFiles.value = allWatchFiles.value.map(f => f.path);
        }

        async function loadWatchFolders(isInit = false) {
            wfLoading.value = true;
            try {
                const res = await fetch('/api/watchfolders');
                const data = await res.json();
                watchFolders.value = data;

                const currentPaths = new Set(data.flatMap(wf => wf.files.map(f => f.path)));

                if (isInit) {
                    knownFilePaths = currentPaths;
                    selectAllFiles();
                } else {
                    const newFiles = [...currentPaths].filter(p => !knownFilePaths.has(p));
                    if (newFiles.length > 0) {
                        showToast(`发现 ${newFiles.length} 个新文件`, 'info');
                        for (const p of newFiles) {
                            if (!selectedFiles.value.includes(p)) {
                                selectedFiles.value.push(p);
                            }
                        }
                        if (autoTranscode.value) {
                            autoStartTranscode(newFiles);
                        }
                    }
                    knownFilePaths = currentPaths;
                }
            } catch (e) {
                console.error('Watch folders error:', e);
            } finally {
                wfLoading.value = false;
            }
        }

        async function addWatchFolder() {
            if (!newFolderPath.value) return;
            try {
                const res = await fetch('/api/watchfolders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: newFolderPath.value }),
                });
                if (res.ok) {
                    newFolderPath.value = '';
                    await loadWatchFolders();
                    selectAllFiles();
                }
            } catch (e) {
                console.error('Add folder error:', e);
            }
        }

        function pathToB64(path) {
            const b64 = btoa(unescape(encodeURIComponent(path)));
            return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }

        async function removeWatchFolder(path) {
            try {
                await fetch(`/api/watchfolders/${pathToB64(path)}`, { method: 'DELETE' });
                const folderFiles = watchFolders.value
                    .find(wf => wf.folder.path === path)?.files.map(f => f.path) || [];
                selectedFiles.value = selectedFiles.value.filter(p => !folderFiles.includes(p));
                loadWatchFolders();
            } catch (e) {
                console.error('Remove folder error:', e);
            }
        }

        // ── Per-folder output settings ──
        async function updateFolderDest(folderPath, dest) {
            try {
                await fetch(`/api/watchfolders/${pathToB64(folderPath)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ output_dest: dest }),
                });
                const wf = watchFolders.value.find(w => w.folder.path === folderPath);
                if (wf) wf.folder.output_dest = dest;
            } catch (e) {
                console.error('Update folder dest error:', e);
            }
        }

        async function updateFolderDir(folderPath, dir) {
            try {
                await fetch(`/api/watchfolders/${pathToB64(folderPath)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ output_dir: dir }),
                });
                const wf = watchFolders.value.find(w => w.folder.path === folderPath);
                if (wf) wf.folder.output_dir = dir;
            } catch (e) {
                console.error('Update folder dir error:', e);
            }
        }

        // Per-folder output dir browser
        const showFolderDirDialog = ref(false);
        const folderDirBrowser = reactive({ current: '/', parent: null, entries: [] });
        let browsingFolderPath = '';

        const folderDirSegments = computed(() => {
            const parts = folderDirBrowser.current.split('/').filter(Boolean);
            return parts.map((name, i) => ({
                name,
                path: '/' + parts.slice(0, i + 1).join('/'),
            }));
        });

        function openFolderDirBrowser(folderPath) {
            browsingFolderPath = folderPath;
            showFolderDirDialog.value = true;
            browseFolderDir('/');
        }

        async function browseFolderDir(path) {
            try {
                const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
                const data = await res.json();
                Object.assign(folderDirBrowser, data);
            } catch (e) {
                console.error('Browse folder dir error:', e);
            }
        }

        function goFolderDirParent() {
            if (folderDirBrowser.parent) browseFolderDir(folderDirBrowser.parent);
        }

        function selectFolderDir() {
            updateFolderDir(browsingFolderPath, folderDirBrowser.current);
            showFolderDirDialog.value = false;
        }

        async function rescanFolders() {
            wfLoading.value = true;
            try {
                const res = await fetch('/api/watchfolders/scan', { method: 'POST' });
                const data = await res.json();
                watchFolders.value = data;
                const currentPaths = new Set(data.flatMap(wf => wf.files.map(f => f.path)));
                const newFiles = [...currentPaths].filter(p => !knownFilePaths.has(p));
                if (newFiles.length > 0) {
                    showToast(`发现 ${newFiles.length} 个新文件`, 'info');
                    for (const p of newFiles) {
                        if (!selectedFiles.value.includes(p)) selectedFiles.value.push(p);
                    }
                    if (autoTranscode.value) autoStartTranscode(newFiles);
                }
                knownFilePaths = currentPaths;
            } catch (e) {
                console.error('Rescan error:', e);
            } finally {
                wfLoading.value = false;
            }
        }

        function toggleFile(path) {
            const idx = selectedFiles.value.indexOf(path);
            if (idx >= 0) selectedFiles.value.splice(idx, 1);
            else selectedFiles.value.push(path);
        }

        function toggleAllWatchFiles() {
            if (allWatchFilesSelected.value) {
                selectedFiles.value = [];
            } else {
                selectAllFiles();
            }
        }

        function isFolderAllSelected(wf) {
            return wf.files.length > 0 && wf.files.every(f => selectedFiles.value.includes(f.path));
        }

        function toggleFolderFiles(wf) {
            const paths = wf.files.map(f => f.path);
            if (isFolderAllSelected(wf)) {
                selectedFiles.value = selectedFiles.value.filter(p => !paths.includes(p));
            } else {
                const toAdd = paths.filter(p => !selectedFiles.value.includes(p));
                selectedFiles.value.push(...toAdd);
            }
        }

        function startPolling() {
            pollTimer = setInterval(() => {
                if (watchFolders.value.length > 0) loadWatchFolders(false);
            }, 10000);
        }

        // Browse dialog helpers (for adding watch folders)
        async function browseTo(path) {
            try {
                const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
                const data = await res.json();
                Object.assign(fileBrowser, data);
            } catch (e) {
                console.error('Browse error:', e);
            }
        }

        function goParent() {
            if (fileBrowser.parent) browseTo(fileBrowser.parent);
        }

        function selectBrowsedFolder() {
            newFolderPath.value = fileBrowser.current;
            showBrowseDialog.value = false;
            addWatchFolder();
        }

        // ── Hardware ──
        const hardware = reactive({ encoders: [], ffmpeg_version: '' });
        const hwLoading = ref(false);

        const availableEncoders = computed(() =>
            hardware.encoders.filter(e => e.available)
        );

        async function detectHardware(refresh = false) {
            hwLoading.value = true;
            try {
                const res = await fetch(`/api/hardware?refresh=${refresh}`);
                const data = await res.json();
                Object.assign(hardware, data);
            } catch (e) {
                console.error('Hardware detect error:', e);
            } finally {
                hwLoading.value = false;
            }
        }

        function hwIcon(type) {
            const icons = { nvidia: '🟢', intel: '🔵', amd: '🔴', apple: '🍎', software: '💻' };
            return icons[type] || '⚙️';
        }

        // ── Transcode ──
        const transcodeForm = reactive({
            encoder: 'libsvtav1',
            crf: 28,
            preset: 8,
            suffix: '_av1',
            output_ext: 'auto',
        });
        const tasks = ref([]);
        const selectedPreset = ref(localStorage.getItem('fft_last_preset') || '');

        watch(selectedPreset, (v) => localStorage.setItem('fft_last_preset', v));

        // Auto-save form whenever any field changes
        watch(() => ({ ...transcodeForm }), () => saveFormToStorage(), { deep: true });

        function saveFormToStorage() {
            localStorage.setItem('fft_transcode_form', JSON.stringify({
                encoder: transcodeForm.encoder,
                crf: transcodeForm.crf,
                preset: transcodeForm.preset,
                suffix: transcodeForm.suffix,
                output_ext: transcodeForm.output_ext,
            }));
        }

        function loadFormFromStorage() {
            try {
                const saved = JSON.parse(localStorage.getItem('fft_transcode_form'));
                if (saved) Object.assign(transcodeForm, saved);
            } catch {}
        }

        // Build file_outputs map: for each file, find its folder's output settings
        function buildFileOutputs(filePaths) {
            const map = {};
            for (const fp of filePaths) {
                for (const wf of watchFolders.value) {
                    if (wf.files.some(f => f.path === fp)) {
                        map[fp] = {
                            output_dest: wf.folder.output_dest || 'beside',
                            output_dir: wf.folder.output_dir || '',
                        };
                        break;
                    }
                }
            }
            return map;
        }

        function buildTranscodeBody(files) {
            return {
                files,
                encoder: transcodeForm.encoder,
                crf: transcodeForm.crf,
                preset: transcodeForm.preset,
                suffix: transcodeForm.suffix,
                output_ext: transcodeForm.output_ext,
                file_outputs: buildFileOutputs(files),
            };
        }

        async function startTranscode() {
            if (!selectedFiles.value.length) return;
            try {
                const res = await fetch('/api/transcode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildTranscodeBody(selectedFiles.value)),
                });
                if (res.ok) {
                    showToast(`已提交 ${selectedFiles.value.length} 个文件转码`, 'info');
                    refreshTasks();
                }
            } catch (e) {
                console.error('Transcode error:', e);
            }
        }

        async function autoStartTranscode(filePaths) {
            if (!filePaths.length) return;
            try {
                const res = await fetch('/api/transcode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildTranscodeBody(filePaths)),
                });
                if (res.ok) {
                    showToast(`自动转码: ${filePaths.length} 个新文件`, 'info');
                    refreshTasks();
                }
            } catch (e) {
                console.error('Auto transcode error:', e);
            }
        }

        async function cancelTask(taskId) {
            await fetch(`/api/transcode/${taskId}`, { method: 'DELETE' });
        }

        const totalEta = computed(() => {
            const active = tasks.value.filter(t => t.status === 'running' || t.status === 'pending');
            if (!active.length) return '';
            const total = active.reduce((sum, t) => sum + (t.eta_seconds || 0), 0);
            if (total <= 0) return '';
            if (total >= 3600) return `预计剩余 ${Math.floor(total / 3600)}h${Math.floor((total % 3600) / 60)}m`;
            if (total >= 60) return `预计剩余 ${Math.floor(total / 60)}m${Math.floor(total % 60)}s`;
            return `预计剩余 ${Math.floor(total)}s`;
        });

        async function refreshTasks() {
            try {
                const res = await fetch('/api/tasks');
                const data = await res.json();
                tasks.value = data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            } catch (e) {
                console.error('Tasks error:', e);
            }
        }

        // ── WebSocket ──
        let ws = null;

        function connectWS() {
            const proto = location.protocol === 'https:' ? 'wss' : 'ws';
            ws = new WebSocket(`${proto}://${location.host}/ws`);
            ws.onmessage = (evt) => {
                const msg = JSON.parse(evt.data);

                // Benchmark messages
                if (msg.type === 'bench_progress') {
                    benchRoundInfo.value = `${msg.encoder} 编码中 ${msg.progress}%` + (msg.speed ? ` (${msg.speed})` : '');
                    return;
                }
                if (msg.type === 'bench_round') {
                    benchRoundInfo.value = `${msg.encoder} 第${msg.round}/${msg.total_rounds}轮完成 (${msg.fps} fps)`;
                    return;
                }
                if (msg.type === 'bench_result') {
                    benchResults.value.push(msg.result);
                    benchRoundInfo.value = '';
                    return;
                }
                if (msg.type === 'bench_done') {
                    benchLoading.value = false;
                    benchRoundInfo.value = '';
                    if (msg.message) showToast(msg.message, 'info');
                    loadBenchHistory();
                    return;
                }

                // Task progress messages
                const idx = tasks.value.findIndex(t => t.task_id === msg.task_id);
                if (idx >= 0) {
                    const prev = tasks.value[idx].status;
                    Object.assign(tasks.value[idx], msg);
                    if (prev !== 'done' && msg.status === 'done') {
                        showToast(`转码完成: ${msg.current_file || msg.task_id}`, 'success');
                    }
                    if (prev !== 'failed' && msg.status === 'failed') {
                        showToast(`转码失败: ${msg.message || msg.task_id}`, 'error');
                    }
                } else {
                    refreshTasks();
                }
            };
            ws.onclose = () => setTimeout(connectWS, 2000);
        }

        // ── Benchmark ──
        const benchResults = ref([]);
        const benchLoading = ref(false);
        const benchEncoders = ref([]);
        const benchRoundInfo = ref('');
        const sysInfo = ref(null);
        const benchHistory = ref(null);
        const benchView = ref('leaderboard');
        const leaderboard = ref([]);
        const lbEncoder = ref('');

        const lbEncoderList = computed(() => {
            const set = new Set(leaderboard.value.map(r => r.encoder));
            return [...set];
        });

        const filteredLeaderboard = computed(() => {
            // Merge my history into leaderboard
            let all = [...leaderboard.value];
            if (benchHistory.value && benchHistory.value.results) {
                for (const r of benchHistory.value.results) {
                    if (!r.error) {
                        all.push({
                            chip: (sysInfo.value ? sysInfo.value.cpu : '本机').replace(/\s+/g, ' '),
                            encoder: r.encoder,
                            score: r.score,
                            note: '本机分数',
                            isMe: true,
                        });
                    }
                }
            }
            // Filter by encoder
            if (lbEncoder.value) {
                all = all.filter(r => r.encoder === lbEncoder.value);
            }
            // Group by encoder
            const groups = {};
            for (const r of all) {
                if (!groups[r.encoder]) groups[r.encoder] = [];
                groups[r.encoder].push(r);
            }
            // Sort each group by score desc
            return Object.keys(groups).map(enc => ({
                encoder: enc,
                items: groups[enc].sort((a, b) => b.score - a.score),
            }));
        });

        async function loadSysInfo() {
            try {
                const res = await fetch('/api/sysinfo');
                sysInfo.value = await res.json();
            } catch (e) {
                console.error('Failed to load sysinfo:', e);
            }
        }

        async function loadBenchHistory() {
            try {
                const res = await fetch('/api/benchmark/history');
                const data = await res.json();
                if (data.results && data.results.length) {
                    benchHistory.value = data;
                }
            } catch (e) {
                console.error('Failed to load bench history:', e);
            }
        }

        async function loadLeaderboard() {
            try {
                const res = await fetch('/api/leaderboard');
                const data = await res.json();
                leaderboard.value = data.sort((a, b) => b.score - a.score);
            } catch (e) {
                console.error('Failed to load leaderboard:', e);
            }
        }

        async function cancelBenchmark() {
            try {
                await fetch('/api/benchmark/cancel', { method: 'POST' });
                benchLoading.value = false;
                benchRoundInfo.value = '';
            } catch (e) {
                console.error('Cancel error:', e);
            }
        }

        function toggleBenchEncoder(name) {
            const idx = benchEncoders.value.indexOf(name);
            if (idx >= 0) benchEncoders.value.splice(idx, 1);
            else benchEncoders.value.push(name);
        }

        function encoderScore(name) {
            if (!benchHistory.value || !benchHistory.value.results) return null;
            const r = benchHistory.value.results.find(x => x.encoder === name && !x.error);
            return r ? r.score : null;
        }

        async function runBenchmark() {
            benchLoading.value = true;
            benchResults.value = [];
            benchView.value = 'test';
            const opts = { method: 'POST' };
            if (benchEncoders.value.length) {
                opts.headers = { 'Content-Type': 'application/json' };
                opts.body = JSON.stringify({ encoders: benchEncoders.value });
            }
            try {
                let res = await fetch('/api/benchmark', opts);
                let data = await res.json();
                if (data.status === 'already_running') {
                    await fetch('/api/benchmark/reset', { method: 'POST' });
                    res = await fetch('/api/benchmark', opts);
                    data = await res.json();
                }
                if (data.status !== 'started') {
                    benchLoading.value = false;
                }
            } catch (e) {
                console.error('Benchmark error:', e);
                benchLoading.value = false;
            }
        }

        function barWidth(score) {
            const max = Math.max(...benchResults.value.map(r => r.score), 1);
            return Math.round((score / max) * 100);
        }

        // ── Presets ──
        const presets = ref([]);
        const newPreset = reactive({ name: '', encoder: 'libsvtav1', crf: 28, preset: 8 });
        const editingPreset = ref(null); // name of preset being edited
        const editPresetData = reactive({ encoder: '', crf: 28, preset: 8, extra_args: '' });

        async function loadPresets() {
            try {
                const res = await fetch('/api/presets');
                presets.value = await res.json();
            } catch (e) {
                console.error('Presets error:', e);
            }
        }

        function presetCmd(p) {
            const parts = ['ffmpeg', '-hide_banner', '-y', '-i', '<input>', '-c:v', p.encoder];
            if (p.encoder === 'libsvtav1') parts.push('-crf', String(p.crf), '-preset', String(p.preset));
            else if (p.encoder === 'libaom-av1') parts.push('-crf', String(p.crf), '-cpu-used', String(p.preset));
            else if (p.encoder === 'librav1e') parts.push('-qp', String(p.crf), '-speed', String(p.preset));
            else if (p.encoder === 'av1_nvenc') parts.push('-cq', String(p.crf), '-preset', 'p5');
            else if (p.encoder === 'av1_qsv') parts.push('-global_quality', String(p.crf), '-preset', 'medium');
            else if (p.encoder === 'av1_amf') parts.push('-quality', String(p.crf), '-usage', 'transcoding');
            parts.push('-c:a', 'copy');
            if (p.extra_args && p.extra_args.length) {
                const args = Array.isArray(p.extra_args) ? p.extra_args : [];
                parts.push(...args);
            }
            parts.push('<output>');
            return parts.join(' ');
        }

        function startEditPreset(p) {
            editingPreset.value = p.name;
            editPresetData.encoder = p.encoder;
            editPresetData.crf = p.crf;
            editPresetData.preset = p.preset;
            editPresetData.extra_args = (p.extra_args || []).join(' ');
        }

        function cancelEditPreset() {
            editingPreset.value = null;
        }

        async function saveEditPreset(p) {
            const extra = editPresetData.extra_args.trim() ? editPresetData.extra_args.trim().split(/\s+/) : [];
            await fetch('/api/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: p.name,
                    encoder: editPresetData.encoder,
                    crf: editPresetData.crf,
                    preset: editPresetData.preset,
                    extra_args: extra,
                }),
            });
            editingPreset.value = null;
            loadPresets();
        }

        async function resetPreset(name) {
            await fetch(`/api/presets/${encodeURIComponent(name)}/reset`, { method: 'POST' });
            loadPresets();
        }

        async function parsePresetCmd(p, cmdStr) {
            const parts = cmdStr.trim().split(/\s+/);
            let encoder = p.encoder, crf = p.crf, preset = p.preset;
            const extra = [];
            const skip = new Set(['ffmpeg','-hide_banner','-y','-i','<input>','<output>','-c:a','copy']);
            const crfKeys = new Set(['-crf','-qp','-cq','-global_quality','-quality']);
            const presetKeys = new Set(['-preset','-cpu-used','-speed','-usage']);
            for (let i = 0; i < parts.length; i++) {
                if (skip.has(parts[i])) continue;
                if (parts[i] === '-c:v' && parts[i+1]) { encoder = parts[++i]; continue; }
                if (crfKeys.has(parts[i]) && parts[i+1]) { crf = parseInt(parts[++i]) || crf; continue; }
                if (presetKeys.has(parts[i]) && parts[i+1]) {
                    const v = parseInt(parts[i+1]);
                    if (!isNaN(v)) preset = v;
                    i++; continue;
                }
                extra.push(parts[i]);
            }
            await fetch('/api/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: p.name, encoder, crf, preset, extra_args: extra }),
            });
            loadPresets();
        }

        function applyPreset() {
            const p = presets.value.find(x => x.name === selectedPreset.value);
            if (p) {
                transcodeForm.encoder = p.encoder;
                transcodeForm.crf = p.crf;
                transcodeForm.preset = p.preset;
                if (p.output_ext) transcodeForm.output_ext = p.output_ext;
                saveFormToStorage();
            }
        }

        async function savePreset() {
            if (!newPreset.name) return;
            await fetch('/api/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newPreset),
            });
            loadPresets();
            newPreset.name = '';
        }

        async function deletePreset(name) {
            await fetch(`/api/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
            loadPresets();
        }

        // ── Utils ──
        function formatSize(bytes) {
            if (!bytes) return '';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let i = 0;
            let size = bytes;
            while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
            return size.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
        }

        // ── Lifecycle ──
        onMounted(async () => {
            loadFormFromStorage();
            await detectHardware(false);
            await loadPresets();
            if (selectedPreset.value && !localStorage.getItem('fft_transcode_form')) {
                applyPreset();
            }
            await loadWatchFolders(true);
            refreshTasks();
            loadSysInfo();
            loadBenchHistory();
            loadLeaderboard();
            connectWS();
            startPolling();
        });

        onUnmounted(() => {
            if (ws) ws.close();
            if (pollTimer) clearInterval(pollTimer);
        });

        return {
            rightTab, toasts,
            // Watch folders
            watchFolders, wfLoading, newFolderPath, showBrowseDialog, selectedFiles,
            allWatchFiles, allWatchFilesSelected, autoTranscode,
            loadWatchFolders, addWatchFolder, removeWatchFolder, rescanFolders,
            toggleFile, toggleAllWatchFiles, isFolderAllSelected, toggleFolderFiles,
            // Per-folder output
            updateFolderDest, updateFolderDir,
            showFolderDirDialog, folderDirBrowser, folderDirSegments,
            openFolderDirBrowser, browseFolderDir, goFolderDirParent, selectFolderDir,
            // Browse dialog
            fileBrowser, pathSegments, browseTo, goParent, selectBrowsedFolder,
            // Hardware
            hardware, hwLoading, availableEncoders, detectHardware, hwIcon,
            // Transcode
            transcodeForm, tasks, totalEta, selectedPreset, startTranscode, cancelTask, refreshTasks,
            // Benchmark
            benchResults, benchLoading, benchEncoders, benchRoundInfo, sysInfo, benchHistory,
            benchView, leaderboard, lbEncoder, lbEncoderList, filteredLeaderboard,
            toggleBenchEncoder, encoderScore, runBenchmark, cancelBenchmark, barWidth,
            // Presets
            presets, newPreset, applyPreset, savePreset, deletePreset,
            editingPreset, editPresetData, presetCmd,
            startEditPreset, cancelEditPreset, saveEditPreset, resetPreset,
            // Utils
            formatSize,
        };
    },
}).mount('#app');
