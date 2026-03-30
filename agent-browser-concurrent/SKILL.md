---
name: agent-browser-concurrent
description: Simple concurrent browser automation with single entry point.
---

# agent-browser-concurrent

Concurrent browser automation with isolated sessions.

## Quick Start

```bash
# Interactive session
./scripts/concurrent-browser.sh https://app.example.com/dashboard

# Run command directly  
./scripts/concurrent-browser.sh https://app.example.com/dashboard snapshot -i

# Concurrent sessions
./scripts/concurrent-browser.sh https://app.example.com reviewer-a click @e2
./scripts/concurrent-browser.sh https://app.example.com reviewer-b click @e3
```

## Usage

Sessions are automatically derived from URLs:

```bash
# https://app.example.com/dashboard → https-app-example-com
SESSION="$(./scripts/concurrent-browser.sh https://app.example.com/dashboard)"

# With suffix for concurrency
SESSION="$(./scripts/concurrent-browser.sh https://app.example.com reviewer-a)"
```

### State Files

- **Shared seed**: `~/.agent-browser-concurrent/agent-browser-state.json`
- **Per-session**: `~/.agent-browser-concurrent/session-states/<session>.json`
- **Override**: `export AGENT_BROWSER_CONCURRENT_STATE_DIR=/custom/path`

### Authentication

The script automatically handles authentication when cookies are present:

```bash
# Authenticated sites (auto-detected)
./scripts/concurrent-browser.sh https://app.example.com/dashboard
```

### Parallel Execution

```bash
# Different origins
./scripts/concurrent-browser.sh https://github.com snapshot -i &
./scripts/concurrent-browser.sh https://vercel.com snapshot -i &
wait

# Same origin, different sessions  
./scripts/concurrent-browser.sh https://app.example.com reviewer-a click @e2 &
./scripts/concurrent-browser.sh https://app.example.com reviewer-b click @e3 &
wait
```

### Cleanup

```bash
# Clean up current session only
./scripts/concurrent-browser.sh https://app.example.com cleanup

# List all sessions
agent-browser session list

# Close all sessions (use with caution)
agent-browser close --all

# Reset specific session state
rm "$HOME/.agent-browser-concurrent/session-states/<session>.json"
```

## Best Practices

- Use `snapshot -i` and `@e` refs over brittle selectors
- Add suffixes for same-origin concurrency
- Keep sessions scoped to single-origin tasks
- Always close sessions when done
