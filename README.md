# FFT — FFmpeg AV1 Transcoder

FFT 是一个面向 AV1 转码工作流的本地 Web 工具。它把目录监控、文件对比、在线调用、预设管理、硬件能力探测、跑分记录和报告导出放在同一个界面里，适合在个人电脑、工作站或家庭局域网内批量管理视频转码任务。

后端使用 Go、Gin、SQLite，前端使用 React、TypeScript、Tailwind CSS。核心转码由本机或容器内的 FFmpeg / ffprobe 完成。

## 功能特点

- 目录监控：按任务管理源目录和输出目录，支持手动执行、自动扫描、新文件自动转码和任务报告。
- 文件管理：左右对比源文件与 AV1 输出文件，按“保持不动 / 转码新增 / 强制转码”过滤并批量选择。
- 在线调用：拖拽上传视频，选择本机可用预设后转码，完成后直接从浏览器下载结果。
- 预设系统：内置 CPU、NVIDIA、Intel、AMD 预设分类，自动隐藏当前机器不可用的编码方式。
- AV1 工作流：支持 SVT-AV1、libaom-av1、rav1e、Intel QSV、NVIDIA NVENC、AMD AMF 等编码器。
- 硬件探测：展示 CPU、内存、GPU、硬件编码器、FFmpeg 编码器能力和 GPU 负载。
- 实时进度：任务列表、控制台、文件管理页联动展示转码进度和单文件状态。
- 跑分与排行：记录本机编码器测试结果，并按编码器类别展示排行榜。
- 报告导出：任务完成后可生成 PDF 报告，便于归档或对比。
- 本地持久化：SQLite 保存目录监控、预设、任务、跑分和历史状态，后端重启不会清空控制台数据。
- 局域网访问：默认监听 `0.0.0.0:8166`，同一局域网设备可访问服务地址。

## 快速开始

### 下载发布包

GitHub Release 会提供这些产物：

| 产物 | 说明 |
| --- | --- |
| `FFT-windows-x64-full.zip` | Windows 完整包，内置 FFmpeg / ffprobe，适合直接运行 |
| `FFT-windows-x64-lite.zip` | Windows 精简包，需要系统 PATH 中已有 FFmpeg / ffprobe |
| `FFT-macos-arm64.tar.gz` | macOS Apple Silicon 版本 |
| `FFT-macos-x64.tar.gz` | macOS Intel 版本 |

桌面发布包默认会在启动后打开浏览器。Windows 如果首次运行被系统拦截，请允许本程序访问本机网络；局域网访问还需要防火墙放行 8166 端口。

### 从源码运行

依赖：

- Go
- Node.js 22+
- FFmpeg 与 ffprobe

```bash
npm install --prefix frontend
npm run build
npm run server
```

服务默认监听 `http://0.0.0.0:8166`。启动日志会输出本机与局域网访问地址。

开发时可以分别启动后端和 Vite：

```bash
npm run server
npm run dev
```

Vite 会把 `/api` 和 `/ws` 代理到 `http://127.0.0.1:8166`。

### Docker

Compose 方式：

```bash
docker compose up -d
```

需要 NVIDIA GPU 镜像时：

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

需要 Intel QSV 镜像时：

```bash
docker compose -f docker-compose.yml -f docker-compose.intel.yml up -d
```

普通 Docker 方式：

```bash
docker run -d --name fft-go \
  -p 8166:8166 \
  -v ./videos:/videos \
  -v ./data:/app/data \
  ghcr.io/limbuntu/fft-go:latest
```

NVIDIA GPU：

```bash
docker run -d --name fft-go \
  --gpus all \
  -p 8166:8166 \
  -v ./videos:/videos \
  -v ./data:/app/data \
  ghcr.io/limbuntu/fft-go:gpu
```

Intel QSV：

```bash
docker run -d --name fft-go \
  --device /dev/dri:/dev/dri \
  -p 8166:8166 \
  -v ./videos:/videos \
  -v ./data:/app/data \
  ghcr.io/limbuntu/fft-go:intel
```

## 项目结构

```text
FFT/
├── cmd/server/              # Go 服务入口
├── internal/                # Gin API、业务逻辑、SQLite、WebSocket、FFmpeg 调度
├── frontend/                # React + TypeScript + Tailwind CSS 前端
├── .github/workflows/       # GitHub Actions 构建与发布
├── bench_leaderboard.json   # 内置跑分展示数据
├── Dockerfile               # CPU 容器镜像
├── Dockerfile.gpu           # NVIDIA GPU 容器镜像
├── Dockerfile.intel         # Intel QSV 容器镜像
└── docker-compose*.yml      # Compose 启动模板
```

运行时数据默认写在项目根目录或 `FFT_DATA_DIR` 指定目录中：

```text
fft.db          # SQLite 数据库
logs/fft.log    # 运行日志
cache/          # 在线调用上传与输出缓存
```

这些文件都属于本地运行数据，不应提交到 Git。

## 环境指标

| 项目 | 建议 |
| --- | --- |
| CPU 转码 | 现代多核 CPU，SVT-AV1 更适合常规批量转码 |
| NVIDIA | 需要支持 AV1 NVENC 的显卡、驱动与 FFmpeg 编码器 |
| Intel | 需要支持 AV1 QSV 的核显或独显，以及可用的 VA-API / QSV 运行时 |
| AMD | 需要支持 AV1 AMF 的显卡、驱动与 FFmpeg 编码器 |
| 内存 | 建议 8 GB 起，4K 或批量任务建议更高 |
| 磁盘 | 输出目录需要预留源文件大小的额外空间 |

FFT 会根据 `ffmpeg -encoders` 和轻量探测结果决定哪些预设可用。某个硬件预设不显示，通常表示当前 FFmpeg、驱动或硬件不支持对应编码器。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FFT_HOST` | `0.0.0.0` | 后端监听地址 |
| `FFT_PORT` | `8166` | 后端监听端口 |
| `FFT_DATA_DIR` | 当前工作目录 | SQLite、日志、缓存等运行数据目录 |
| `FFT_CACHE_DIR` | `$FFT_DATA_DIR/cache` | 在线调用上传文件和转码输出缓存目录 |
| `FFT_DB` | `$FFT_DATA_DIR/fft.db` | SQLite 数据库路径 |
| `FFT_STATIC_DIR` | `frontend/dist` 或 `static` | 前端静态资源目录 |
| `FFT_LOG_FILE` | `$FFT_DATA_DIR/logs/fft.log` | 日志文件路径 |
| `FFT_OPEN_BROWSER` | `false` | 启动后是否自动打开浏览器 |

发布包会把 `FFT_OPEN_BROWSER` 的默认值编译为 `true`；源码运行和 Docker 默认保持 `false`。

## 技术栈

- 后端：Go、Gin、SQLite、WebSocket
- 前端：React 18、TypeScript、Vite、Tailwind CSS、lucide-react
- 转码：FFmpeg、ffprobe、SVT-AV1、libaom-av1、rav1e、NVENC、QSV、AMF
- 构建：Docker、Docker Compose、GitHub Actions、GHCR

## 转码效果示例

实际体积、速度和画质取决于片源、分辨率、运动复杂度、编码器、CRF / QP、preset、硬件驱动和 FFmpeg 版本。下面是推荐记录方式，便于在 README 或 Release Note 中补充真实样片数据：

| 场景 | 源文件 | 推荐预设 | 输出 | 记录指标 |
| --- | --- | --- | --- | --- |
| 1080p 录屏 | H.264 / HEVC | SVT-AV1 均衡或视觉无损 | AV1 + AAC / copy audio | 体积、平均码率、耗时、VMAF 或主观观感 |
| 4K 游戏录像 | H.264 高码率 | Intel QSV / NVIDIA NVENC | AV1 MP4 | 速度、GPU 占用、输出体积 |
| 归档素材 | HEVC / ProRes | SVT-AV1 高质量 | AV1 MKV / MP4 | 画质、码率、兼容性 |

建议提交示例时同时记录：

- FFmpeg 版本
- CPU / GPU 型号
- 输入格式、分辨率、帧率、码率
- 使用预设和关键参数
- 输出格式、体积、耗时和主观结论

## 路线图

- 更完整的跨平台桌面封装。
- 更细的硬件能力探测与失败原因提示。
- 可导入导出的预设包。
- 更丰富的任务报告模板。
- 可选的多任务队列策略和并发控制。
- 官方示例素材与公开转码效果截图。

## 验证

```bash
npm run build
npm run test
```

`npm run test` 会执行 Go 测试。构建前请确认 FFmpeg / ffprobe 在 PATH 中可用。
