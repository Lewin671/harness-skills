#!/usr/bin/env bash
# open.sh - Robust browser launcher for CDP (macOS optimized)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

echo "=== Browser Launch Environment ==="
echo "Binary:   $BROWSER_BIN"
echo "Data Dir: $BROWSER_DATA_DIR"
echo "CDP Port: $BROWSER_PORT"
echo "-----------------------------------"

# 1. 清理锁文件
if [ -d "$BROWSER_DATA_DIR" ]; then
    find "$BROWSER_DATA_DIR" -name "SingletonLock" -delete 2>/dev/null
fi

# 2. 检查端口是否已在线
if curl -s "http://localhost:$BROWSER_PORT/json/version" > /dev/null 2>&1; then
    echo "Port $BROWSER_PORT is already active."
    if "$SCRIPT_DIR/status.sh" > /dev/null 2>&1; then
        echo "CDP is ready. No action needed."
        exit 0
    fi
fi

# 3. 启动浏览器
echo "Launching browser..."

if [[ "$OSTYPE" == "darwin"* ]]; then
    # 在 macOS 上，使用 'open -n -a' 启动可以确保进程脱离当前 shell 进程组，不会被清理
    # -n: 打开新实例
    # -a: 指定应用程序
    # --args: 传递参数
    open -n -a "$BROWSER_BIN" --args \
      --remote-debugging-port="$BROWSER_PORT" \
      --user-data-dir="$BROWSER_DATA_DIR" \
      --no-first-run \
      --no-default-browser-check \
      "$@"
else
    # Linux 或其他环境使用 nohup
    nohup "$BROWSER_BIN" \
      --remote-debugging-port="$BROWSER_PORT" \
      --user-data-dir="$BROWSER_DATA_DIR" \
      --no-first-run \
      --no-default-browser-check \
      --no-sandbox \
      "$@" > /tmp/browser_cdp.log 2>&1 &
    disown
fi

# 4. 等待就绪
echo "Waiting for CDP to respond on port $BROWSER_PORT..."
MAX_RETRIES=30
for ((i=1; i<=MAX_RETRIES; i++)); do
    if "$SCRIPT_DIR/status.sh" > /dev/null 2>&1; then
        # 5. 记录精确 PID（仅通过 CDP 端口定位监听进程，避免影响其他浏览器实例）
        CDP_PID=$(lsof -n -i "tcp:$BROWSER_PORT" -s TCP:LISTEN 2>/dev/null | awk 'NR==2 {print $2}')
        if [ -n "$CDP_PID" ]; then
            echo "$CDP_PID" > "$PID_FILE"
            echo "Browser PID $CDP_PID saved to $PID_FILE"
        else
            echo "Warning: CDP is responding but could not determine browser PID via lsof." \
                 "close.sh will fall back to port-based lookup." >&2
        fi
        echo "Successfully launched browser."
        exit 0
    fi
    sleep 1
done

echo "Error: CDP port $BROWSER_PORT did not respond."
exit 1
