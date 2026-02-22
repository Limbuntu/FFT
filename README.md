# FFT — FFmpeg AV1 Transcoder

基于 Web 的视频转码工具，专注 AV1 编码。支持硬件加速、批量转码、编码器跑分对比和监控文件夹自动转码。

![Python](https://img.shields.io/badge/Python-3.12+-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-latest-green)
![Vue.js](https://img.shields.io/badge/Vue.js-3-brightgreen)
![License](https://img.shields.io/badge/License-MIT-yellow)

## 功能特性

- **多编码器支持** — SVT-AV1、libaom-av1、rav1e，以及 NVIDIA/Intel/AMD 硬件加速编码器
- **硬件自动检测** — 自动识别系统可用的编码器和 GPU
- **批量转码** — 监控文件夹，选择文件批量转码，实时进度和 ETA 显示
- **编码器跑分** — 对比不同编码器的性能和压缩率，支持排行榜
- **预设管理** — 内置多种预设（极速/均衡/高质量/无损），支持自定义
- **实时反馈** — WebSocket 实时推送转码进度、速度、剩余时间
- **自动转码** — 监控文件夹新增文件时自动开始转码

## 快速开始

### Docker（推荐）

```bash
docker run -d -p 8166:8166 -v ./videos:/videos ghcr.io/limbuntu/fft:latest
```

GPU 版本（需要 NVIDIA Docker Runtime）：

```bash
docker run -d -p 8166:8166 --gpus all -v ./videos:/videos ghcr.io/limbuntu/fft:gpu
```

### 桌面版

从 [Releases](https://github.com/Limbuntu/FFT/releases) 下载对应平台的压缩包：

| 平台 | 完整版（含 FFmpeg） | 精简版（需自装 FFmpeg） |
|------|---------------------|------------------------|
| Windows x64 | `FFT-windows-x64-full.zip` | `FFT-windows-x64-lite.zip` |
| macOS arm64 | `FFT-macos-arm64-full.tar.gz` | `FFT-macos-arm64-lite.tar.gz` |

解压后运行 `FFT`（macOS）或 `FFT.exe`（Windows），浏览器会自动打开。

### 从源码运行

```bash
git clone https://github.com/Limbuntu/FFT.git
cd FFT
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8166
```

需要系统已安装 `ffmpeg` 和 `ffprobe`。

## 项目结构

```
FFT/
├── app/                # 后端（FastAPI）
│   ├── main.py         # 应用入口
│   ├── api.py          # REST API 路由
│   ├── transcoder.py   # 转码引擎
│   ├── benchmark.py    # 跑分测试
│   ├── hardware.py     # 硬件检测
│   ├── presets.py      # 预设管理
│   ├── watchfolders.py # 监控文件夹
│   └── ws.py           # WebSocket 广播
├── static/             # 前端（Vue 3 + Pico CSS）
├── Dockerfile          # CPU Docker 镜像
├── Dockerfile.gpu      # GPU Docker 镜像
├── fft.spec            # PyInstaller 打包配置
├── run.py              # 桌面版启动入口
└── requirements.txt    # Python 依赖
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FFT_PORT` | `8166` | 监听端口 |

## 技术栈

- **后端** — Python 3.12 / FastAPI / Uvicorn / WebSocket
- **前端** — Vue 3 / Pico CSS
- **转码** — FFmpeg
- **打包** — PyInstaller / Docker
