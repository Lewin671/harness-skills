#!/usr/bin/env bash
# open.sh - Robust browser launcher for CDP

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

echo "=== Browser Launch Environment ==="
echo "Binary:   $BROWSER_BIN"
echo "Data Dir: $BROWSER_DATA_DIR"
echo "CDP Port: $BROWSER_PORT"
echo "-----------------------------------"

# 1. 边界处理: 自动清理浏览器残留锁文件
# Chrome 在崩溃时可能留下 SingletonLock，导致无法二次启动
if [ -d "$BROWSER_DATA_DIR/Default" ]; then
    find "$BROWSER_DATA_DIR" -name "SingletonLock" -delete 2>/dev/null
    echo "Cleaned up any residual browser locks."
fi

# 2. 边界处理: 检查端口占用情况
if curl -s "http://localhost:$BROWSER_PORT/json/version" > /dev/null 2>&1; then
    echo "Note: Port $BROWSER_PORT is already in use by a browser."
    echo "The browser is likely already running. Checking if it's the correct profile..."
    # 如果已经在线，我们直接调用 status 检查，如果 ready 就直接退出（复用已有的）
    if "$SCRIPT_DIR/status.sh" > /dev/null 2>&1; then
        echo "CDP is already ready. No action needed."
        exit 0
    fi
fi

# 3. 边界处理: 确保数据目录存在且可写
mkdir -p "$BROWSER_DATA_DIR" || { echo "Error: Could not create data directory $BROWSER_DATA_DIR"; exit 1; }

# 4. 启动浏览器
echo "Starting browser in HEADED mode..."
"$BROWSER_BIN" \
  --remote-debugging-port="$BROWSER_PORT" \
  --user-data-dir="$BROWSER_DATA_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --no-sandbox \
  "$@" > /dev/null 2>&1 &

PID=$!
echo $PID > "$HOME/.config/open-browser-cdp/browser.pid"
echo "Process started (PID: $PID). Waiting for endpoint..."

# 5. 最终验证: 轮询检查 CDP 端口是否上线
MAX_RETRIES=20
for ((i=1; i<=MAX_RETRIES; i++)); do
    if "$SCRIPT_DIR/status.sh" > /dev/null 2>&1; then
        echo "Successfully launched browser on port $BROWSER_PORT."
        exit 0
    fi
    sleep 0.5
done

echo "Error: Browser started but CDP port $BROWSER_PORT did not respond."
echo "Tip: Check if another instance of the same browser is already running with this profile."
exit 1
