---
name: open-browser-cdp
description: Use this skill when the task needs a visible Chromium browser with a persistent profile and CDP handoff so agent-browser can control an already-open browser session instead of launching its own.
---

# Open Browser CDP

当任务需要“可见浏览器 + 持久化登录态 + `agent-browser` 通过 CDP 接管现有浏览器”时，使用此 skill。

## 何时使用

- 用户要在已登录的网站里继续操作，且需要保留 Cookie、登录态或扩展。
- 用户希望看到真实浏览器窗口，而不是只跑无头浏览器。
- 任务必须复用一个固定 profile，避免 `agent-browser` 自己起浏览器导致 profile 冲突。

不要在以下情况优先使用它：

- 只需要一次性的无状态抓取，且不需要可见窗口或持久化会话。
- 任务本身不依赖现有 profile、登录态或扩展。

## Start Here

1. 先把脚本路径解析到当前 skill 目录，不要假设当前工作目录刚好是这个目录。
   规则：`./scripts/open.sh` 和 `./scripts/status.sh` 都是“相对 skill 目录”的路径。
2. 先运行 `scripts/open.sh [url]`。
   它会读取 `~/.config/open-browser-cdp/config.env`，按配置的 `BROWSER_PORT` 和 `BROWSER_DATA_DIR` 启动或复用浏览器。
3. 再运行 `scripts/status.sh`。
   只有它返回成功时，才继续调用 `agent-browser --cdp <port> ...`。
4. `agent-browser` 使用的端口必须和 `BROWSER_PORT` 完全一致。
   如果没改过配置，默认是 `9222`；如果改过配置，后续命令也必须改成同一个端口。

## 默认工作流

```bash
# 如果当前目录就是 skill 目录
./scripts/open.sh https://github.com

# 检查 CDP 是否就绪
./scripts/status.sh

# 使用和配置一致的端口。默认 9222；如果你改过 BROWSER_PORT，就替换成相同端口。
PORT=9222
agent-browser --cdp "$PORT" snapshot -i
agent-browser --cdp "$PORT" click @e1
```

## 行为约定

- `open.sh` 成功时会输出 `Browser PID:`，并在端口已可用时直接复用已有实例；不要为了“确保干净”反复重启。
- `status.sh` 是是否可以继续接管浏览器的门槛检查；失败时，不要继续运行 `agent-browser`。
- 除非你明确要连别的 CDP 实例，否则不要省略 `--cdp <port>`，也不要直接运行会自行拉起浏览器的 `agent-browser open`。
- `~/.config/open-browser-cdp/config.env` 是端口、浏览器路径、数据目录的事实来源；整个任务期间保持这些值一致。

## 失败处理

- `open.sh` 失败：
  先看脚本输出，再检查浏览器是否存在、`BROWSER_PORT` 是否被别的进程占用、`BROWSER_DATA_DIR` 是否被别的浏览器实例锁住。自动探测不到浏览器时，在 `config.env` 里手动设置 `BROWSER_BIN`。
- `status.sh` 失败：
  说明 CDP 还没准备好，或者端口配置不一致。先修复环境，再重试，不要盲目调用 `agent-browser`。
- 需要修改路径或端口：
  编辑 `~/.config/open-browser-cdp/config.env`，然后让 `open.sh`、`status.sh` 和 `agent-browser --cdp <port>` 使用同一组配置。

## Read Next

- 需要更完整的配置样例、脚本行为说明和排障提示时，读 [`README.md`](./README.md)。
- 需要确认实际脚本行为时，读 [`scripts/open.sh`](./scripts/open.sh)、[`scripts/status.sh`](./scripts/status.sh) 和 [`scripts/utils.sh`](./scripts/utils.sh)。
