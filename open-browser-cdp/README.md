# Open Browser CDP Skill

这是一个用于启动“可见浏览器（headed browser）”并开启 Chrome DevTools Protocol (CDP) 端口的 skill。它的目标是让 `agent-browser` 复用一个已经打开的浏览器会话，而不是再启动一个新的浏览器实例。

## 主要特性

- **持久化配置**：支持自定义浏览器数据目录（User Data Dir），保存登录状态、Cookie 和扩展。
- **Headed 模式**：强制以可见窗口模式启动，方便观察 Agent 的操作过程。
- **环境隔离**：通过持久化配置文件（`~/.config/open-browser-cdp/config.env`）保存设置，不依赖 `.zshrc` 或 `.bashrc`。
- **CDP 驱动**：开启 CDP 端口（默认 `9222`，可配置），让 `agent-browser` 通过远程调试协议接管浏览器。

## 快速开始

### 1. 配置 (Config)

所有的配置都保存在：`~/.config/open-browser-cdp/config.env`

你可以手动编辑该文件（如果文件不存在，请手动创建）：

```bash
export BROWSER_DATA_DIR="$HOME/.agent-browser-data"
export BROWSER_PORT=9222
# 可选：手动指定浏览器路径；不设置时脚本会自动探测 Chrome / Brave / Edge
export BROWSER_BIN="/path/to/your/browser"
```

### 2. 启动浏览器 (Open)

先确认你运行的是“相对 skill 目录”的脚本路径；不要默认当前目录正好就是这个目录。

如果当前目录就是 skill 目录，可以这样启动：

```bash
./scripts/open.sh https://www.google.com
```

如果当前目录是仓库根目录，则运行：

```bash
open-browser-cdp/scripts/open.sh https://www.google.com
```

`open.sh` 会自动检测系统中的 Google Chrome、Brave 或 Edge 浏览器。它也会在 CDP 端口已经可用时复用已有实例，而不是重复拉起一个新浏览器。成功后会输出浏览器进程 PID。

### 3. 使用 agent-browser 控制

一旦浏览器启动成功，先检查状态，再让 `agent-browser` 通过 `--cdp` 参数连接：

```bash
# 检查 CDP 端口是否在线
./scripts/status.sh

# 如果你没有改过 BROWSER_PORT，就用 9222；
# 如果你改过配置文件，必须改成同一个端口。
PORT=9222
agent-browser --cdp "$PORT" snapshot -i
agent-browser --cdp "$PORT" click @e1
```

### 4. 检查状态

```bash
# 如果当前目录就是 skill 目录
./scripts/status.sh

# 查看浏览器进程状态（使用 open.sh 输出的 PID）
ps -p <PID>
```

## 注意事项

1. **避免冲突**：尽量不要让多个浏览器实例同时使用同一个 `BROWSER_DATA_DIR`。
2. **强制 CDP**：在使用 `agent-browser` 时，必须显式添加 `--cdp <port>` 参数。不要在同一任务里直接运行会自行拉起浏览器的 `agent-browser open`。
3. **环境同步**：如果你手动修改了 `BROWSER_PORT`，请确保 `open.sh`、`status.sh` 和 `agent-browser --cdp <port>` 使用同一个端口。
4. **失败排查**：如果 `open.sh` 失败，优先检查浏览器路径、端口占用和 profile 锁；自动探测不到浏览器时，在配置文件里手动设置 `BROWSER_BIN`。如果 `status.sh` 失败，不要继续跑 `agent-browser`。
