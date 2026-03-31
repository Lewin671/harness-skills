#!/usr/bin/env bash
# setup.sh - Initial configuration for the open-browser-cdp skill

CONFIG_DIR="$HOME/.config/open-browser-cdp"
mkdir -p "$CONFIG_DIR"
CONFIG_FILE="$CONFIG_DIR/config.env"

echo "=== Open Browser CDP Setup ==="
echo "This will create a persistent configuration at $CONFIG_FILE"

# Prompt for Browser Data Directory
current_data_dir=${BROWSER_DATA_DIR:-"$HOME/.agent-browser-data"}
read -rp "Enter your browser data directory [Default: $current_data_dir]: " input_dir
data_dir=${input_dir:-"$current_data_dir"}
# Expand ~ to $HOME
data_dir="${data_dir/#\~/$HOME}"

# Prompt for CDP Port
current_port=${BROWSER_PORT:-9222}
read -rp "Enter the CDP port [Default: $current_port]: " input_port
port=${input_port:-"$current_port"}

# Save to config file
cat <<EOF > "$CONFIG_FILE"
export BROWSER_DATA_DIR="$data_dir"
export BROWSER_PORT=$port
EOF

echo "---"
echo "Configuration saved to $CONFIG_FILE"
echo "Data Directory: $data_dir"
echo "CDP Port: $port"
echo "---"
echo "You're all set! You can now use ./scripts/open.sh to start the browser."
