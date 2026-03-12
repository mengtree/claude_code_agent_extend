# Platform 延迟启动配置

本文档说明如何配置 Platform 平台的模块延迟启动功能。

## 配置项说明

### 1. startupDelayMs - 启动前延迟

**默认值**: `1000` ms

在 Platform 启动后、启动任何模块之前的等待时间。

**用途**: 确保 Platform 完全初始化后再启动模块。

### 2. moduleStartDelayMs - 模块间启动延迟

**默认值**: `2000` ms

每个模块启动之间的间隔时间。

**用途**: 避免同时启动多个模块导致资源竞争。

### 3. delayMs (模块级别) - 单个模块启动延迟

**配置位置**: 模块的 `module.json` 中 `startup.delayMs`

**用途**: 为特定模块设置额外的启动延迟。

## 配置方式

### 方式 1: 配置文件 (Platform/config.json)

```json
{
  "port": 3200,
  "host": "127.0.0.1",
  "modulesRoot": "../Modules",
  "startupDelayMs": 1000,
  "moduleStartDelayMs": 2000
}
```

### 方式 2: 环境变量

```bash
export PLATFORM_APP_STARTUP_DELAY_MS=1000
export PLATFORM_APP_MODULE_START_DELAY_MS=2000

npm start
```

## 启动时序

```
时间轴
─────────────────────────────────────────────────────────────▸
Platform 启动
  │
  ├─ startupDelayMs (1000ms)
  │   │
  │   ▼
  │   模块 1 启动
  │   │
  │   ├─ moduleStartDelayMs (2000ms)
  │   │   │
  │   │   ▼
  │   │   模块 2 启动
  │   │   │
  │   │   ├─ delayMs (模块特定延迟，可选)
  │   │   │   │
  │   │   │   ▼
  │   │   │   模块 3 启动
  │   │   │
  │   │   └─► ...继续
  │   │
  └───► 所有模块启动完成
```

## 日志示例

```
[PlatformApp] Starting platform bus...
[PlatformRuntime] Started

[ModuleSupervisor] Starting module supervisor...
[ModuleSupervisor] Waiting 1000ms before starting modules...

[ModuleSupervisor] Starting module platform-core...
[ModuleSupervisor] Module platform-core started (PID: 12345)

[ModuleSupervisor] Waiting 2000ms before starting sessions...

[ModuleSupervisor] Starting module sessions...
[ModuleSupervisor] Module sessions started (PID: 12346)

[ModuleSupervisor] Started with 2/2 modules
```

## 推荐配置

### 开发环境（快速启动）

```json
{
  "startupDelayMs": 500,
  "moduleStartDelayMs": 1000
}
```

### 生产环境（稳定启动）

```json
{
  "startupDelayMs": 2000,
  "moduleStartDelayMs": 3000
}
```

### 最小延迟（最快启动）

```json
{
  "startupDelayMs": 0,
  "moduleStartDelayMs": 500
}
```

## 模块特定延迟

如果某个模块需要额外的启动时间，可以在模块的 `module.json` 中配置：

```json
{
  "moduleId": "heavy-module",
  "name": "Heavy Computation Module",
  "startup": {
    "autoStart": true,
    "daemon": true,
    "delayMs": 5000
  }
}
```

这将使该模块在前面模块启动后再额外等待 5 秒。

## 故障排查

### 模块启动失败

如果模块启动失败，检查：

1. **端口冲突**: 确保模块配置的端口没有被占用
2. **依赖问题**: 模块可能依赖其他模块先启动
3. **日志查看**: 查看模块输出的错误日志

### 调整延迟

如果遇到问题：

1. 增加 `startupDelayMs` - 给 Platform 更多初始化时间
2. 增加 `moduleStartDelayMs` - 让模块有更多时间稳定
3. 为特定模块添加 `delayMs` - 处理启动慢的模块

## 相关配置

- **健康检查间隔**: `healthCheckInterval` - 检查模块健康状态
- **重启策略**: `restartBackoffMs` - 模块失败后重启延迟
- **最大重启次数**: `maxRestarts` - 模块最大重启次数
