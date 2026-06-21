# FFT — FFmpeg AV1 Transcoder

基于 Web 的视频转码工具，专注 AV1 编码。后端使用 Go 1.22、Gin、SQLite，前端使用 React、TypeScript、Tailwind CSS。

## 功能特性

- 多编码器支持：SVT-AV1、libaom-av1、rav1e，以及 NVIDIA / Intel / AMD AV1 硬件编码器
- 硬件自动检测：识别 FFmpeg 可用编码器并做轻量探测
- 批量转码：监控文件夹、批量选择、实时进度、速度和 ETA
- 自动转码：轮询监控文件夹并自动提交新增文件
- 跑分测试：对比可用编码器性能，保存本机历史并合并排行榜
- 预设管理：内置极速、均衡、高质量、无损预设，支持自定义覆盖
- SQLite 持久化：监控文件夹、预设、跑分历史保存在 `fft.db`
- 日志下载：运行日志写入 `logs/fft.log`

## 快速开始

需要系统已安装 `ffmpeg` 和 `ffprobe`。

```bash
npm install --prefix frontend
npm run build
npm run server
```

如果本机没有 Go，可以使用项目内工具链：

```bash
PATH="$PWD/.tools/go/bin:$PATH" \
GOPATH="$PWD/.cache/gopath" \
GOCACHE="$PWD/.cache/go-build" \
GOFLAGS="-ldflags=-linkmode=external" \
go run ./cmd/server
```

服务默认监听 `http://0.0.0.0:8166`。

## 开发模式

启动后端：

```bash
npm run server
```

启动前端开发服务器：

```bash
npm run dev
```

Vite 会把 `/api` 和 `/ws` 代理到 `http://127.0.0.1:8166`。

## Docker

```bash
docker build -t fft:latest .
docker run --rm -p 8166:8166 -v ./videos:/videos -v ./data:/app/data fft:latest
```

GPU 版本：

```bash
docker build -f Dockerfile.gpu -t fft:gpu .
docker run --rm --gpus all -p 8166:8166 -v ./videos:/videos -v ./data:/app/data fft:gpu
```

Intel QSV 版本：

```bash
docker build -f Dockerfile.intel -t fft:intel .
docker run --rm --device /dev/dri:/dev/dri -p 8166:8166 -v ./videos:/videos -v ./data:/app/data fft:intel
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FFT_HOST` | `0.0.0.0` | 监听地址 |
| `FFT_PORT` | `8166` | 监听端口 |
| `FFT_DATA_DIR` | 项目根目录 | SQLite、日志等运行数据目录 |
| `FFT_DB` | `$FFT_DATA_DIR/fft.db` | SQLite 数据库路径 |
| `FFT_STATIC_DIR` | `frontend/dist` 或 `static` | 前端静态资源目录 |
| `FFT_LOG_FILE` | `$FFT_DATA_DIR/logs/fft.log` | 日志文件路径 |
| `FFT_OPEN_BROWSER` | `false` | 启动后自动打开浏览器 |

## 项目结构

```text
FFT/
├── cmd/server/           # Go 服务入口
├── internal/             # Gin API、业务逻辑、SQLite、WebSocket
├── frontend/             # React + TypeScript + Tailwind CSS
├── bench_leaderboard.json
├── Dockerfile
├── Dockerfile.gpu
└── Dockerfile.intel
```

## 验证

```bash
npm run build
npm run test
```

`npm run test` 会执行 `go test ./...`。
