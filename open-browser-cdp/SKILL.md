---
name: open-browser-cdp
description: 使用此 Skill 启动一个开启了 CDP 的可见浏览器，使 agent-browser 可以通过 CDP 接管并控制它。
---

# Open Browser CDP

此 Skill 允许你启动一个带有持久化配置的浏览器（Google Chrome/Brave/Edge），并让后续的 `agent-browser` 命令通过 Chrome DevTools Protocol (CDP) 端口来操作这个已打开的浏览器实例。

## 核心流程

1. **启动浏览器**：必须先运行 `./scripts/open.sh`。这会启动一个可见窗口的浏览器（Headed Mode）。
2. **确认状态**：运行 `./scripts/status.sh` 确保 CDP 端口（默认 9222）已就绪。
3. **连接控制**：使用 `agent-browser --cdp 9222 <command>` 进行网页操作。

## 为什么这样做？
- **持久化配置**：你的登录状态、Cookie 和浏览器扩展会被保留在 `BROWSER_DATA_DIR` 中。
- **稳定性**：通过 CDP 接管已启动的浏览器，可以避免 `agent-browser` 内部尝试启动另一个浏览器实例而造成的 Profile 冲突（"Profile in use" 报错）。
- **可见性**：这是一个可见的浏览器窗口，方便你实时查看操作效果。

## 与 agent-browser 配合使用示例

```bash
# 启动浏览器并访问指定网页
./scripts/open.sh https://github.com

# 检查就绪状态
./scripts/status.sh

# 通过 CDP 操作已打开的网页 (注意：必须加 --cdp 参数)
agent-browser --cdp 9222 snapshot -i
agent-browser --cdp 9222 click @e1
```

## 注意事项
- **必须带上 --cdp 参数**：操作 `agent-browser` 时，必须显式指定 `--cdp 9222`。**严禁**在没有 `--cdp` 的情况下直接使用 `agent-browser open`。
- **配置优先级**：Skill 会自动加载 `~/.config/open-browser-cdp/config.env` 中的环境变量。如果需要修改路径或端口，请运行 `./scripts/setup.sh`。
- **环境隔离**：不同的 CDP 端口对应不同的浏览器实例和数据目录（若已配置）。

## 常用命令汇总

| 脚本 | 功能 |
|-----------|---------|
| `./scripts/setup.sh` | 初始化：设置数据目录和 CDP 端口 |
| `./scripts/open.sh [url]` | 启动：打开浏览器并启用 CDP |
| `./scripts/status.sh` | 检查：验证 CDP 端口是否可以被连接 |
| `./scripts/close.sh` | 关闭：结束浏览器进程和相关会话 |
