# Open Browser CDP Skill

这是一个用于启动“可见浏览器（Headed Browser）”并开启 Chrome DevTools Protocol (CDP) 端口的 Skill。它旨在解决 `agent-browser` 在多用户环境下 Profile 数据目录不一致以及直接启动内置无头浏览器可能导致崩溃或配置冲突的问题。

## 主要特性

- **持久化配置**：支持自定义浏览器数据目录（User Data Dir），保存登录状态、Cookie 和扩展。
- **Headed 模式**：强制以可见窗口模式启动，方便观察 Agent 的操作过程。
- **环境隔离**：通过持久化配置文件（`~/.config/open-browser-cdp/config.env`）保存设置，不依赖 `.zshrc` 或 `.bashrc`。
- **CDP 驱动**：开启 CDP 端口（默认 9222），让 `agent-browser` 通过远程调试协议接管浏览器。

## 快速开始

### 1. 配置 (Config)

所有的配置都保存在：`~/.config/open-browser-cdp/config.env`

你可以手动编辑该文件（如果文件不存在，请手动创建）：
```bash
export BROWSER_DATA_DIR="/Users/qingyingliu/agent-browser-data"
export BROWSER_PORT=9222
# 可选：手动指定浏览器路径（macOS 默认已指向 Google Chrome）
export BROWSER_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

### 2. 启动浏览器 (Open)

运行以下命令启动浏览器。你可以指定一个初始 URL。

```bash
./scripts/open.sh https://www.google.com
```

脚本会自动检测系统中的 Google Chrome, Brave 或 Edge 浏览器。启动后，它会等待 CDP 端口就绪，成功后输出浏览器进程的 PID。

### 3. 使用 agent-browser 控制

一旦浏览器启动成功，你可以让 Agent 使用 `agent-browser` 并通过 `--cdp` 参数连接：

```bash
# 获取网页快照
agent-browser --cdp 9222 snapshot -i

# 点击元素
agent-browser --cdp 9222 click @e1
```

### 4. 检查状态

```bash
# 检查 CDP 端口是否在线
./scripts/status.sh

# 查看浏览器进程状态（使用 open.sh 输出的 PID）
ps -p <PID>
```

## 注意事项

1. **避免冲突**：请确保在运行 `open.sh` 之前，没有其他浏览器实例正在使用同一个 `BROWSER_DATA_DIR`。
2. **强制 CDP**：在使用 `agent-browser` 时，必须显式添加 `--cdp <port>` 参数。如果直接运行 `agent-browser open`，它会尝试启动内置浏览器，可能会因为 Profile 锁定而报错。
3. **环境同步**：如果手动修改了配置文件中的端口，请确保在调用 `agent-browser` 时也使用相同的端口。
