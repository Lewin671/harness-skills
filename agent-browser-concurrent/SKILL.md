---
name: agent-browser-concurrent
description: Simplified concurrent browser automation workflow with unified entry point.
---

# agent-browser-concurrent

Concurrent browser automation with isolated sessions. Built on top of `agent-browser` CLI.

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

## Simplified Workflow

1. **Start session** - Automatic session naming and state management
2. **Execute commands** - Same session for all operations on same origin
3. **Clean up** - Session isolation prevents cross-contamination

### Session Management

Sessions are automatically derived from the origin URL:

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

## Authentication

The unified script automatically handles the proper authentication sequence:

```bash
# For authenticated sites (auto-detected)
./scripts/concurrent-browser.sh https://app.example.com/dashboard

# Manual control when needed
SESSION="$(./scripts/concurrent-browser.sh https://app.example.com)"
agent-browser --session "$SESSION" --state "$SESSION_STATE_FILE" open about:blank
agent-browser --session "$SESSION" state load "$SESSION_STATE_FILE"
agent-browser --session "$SESSION" open https://app.example.com
```

## Advanced Usage

### Direct Script Access

For fine-grained control, use the underlying scripts:

```bash
SESSION="$(./scripts/origin-session.sh https://app.example.com)"
SESSION_STATE_FILE="$(./scripts/prepare-session-state.sh "$SESSION")"

agent-browser --session "$SESSION" --state "$SESSION_STATE_FILE" open https://app.example.com
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

## State Management

### Bootstrap Authentication

```bash
# Save current browser state
agent-browser --auto-connect state save "$HOME/.agent-browser-concurrent/agent-browser-state.json"

# Or authenticate in a session and save
SESSION="$(./scripts/concurrent-browser.sh https://app.example.com)"
# ... authenticate manually ...
agent-browser --session "$SESSION" state save "$SESSION_STATE_FILE"
cp "$SESSION_STATE_FILE" "$HOME/.agent-browser-concurrent/agent-browser-state.json"
```

### Cleanup

```bash
# List sessions
agent-browser session list

# Close specific session
agent-browser --session "$SESSION" close

# Close all sessions
agent-browser close --all

# Reset session state (force refresh from seed)
rm "$HOME/.agent-browser-concurrent/session-states/<session>.json"
```

## Design Principles

- **Session isolation**: Each agent gets separate browser context
- **State separation**: Private state files prevent concurrent write races
- **Origin-based naming**: Sessions derived from URLs for predictability
- **Explicit state management**: No hidden auto-save assumptions

## Best Practices

- Use `snapshot -i` and `@e` refs over brittle selectors
- Chain commands with `&&` when intermediate output isn't needed
- Add suffixes for same-origin concurrency
- Keep sessions scoped to single-origin tasks
- Always close sessions when done
