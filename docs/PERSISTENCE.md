# Persistence System Documentation

## Overview
The Claude Code Slack Bot now includes a robust persistence layer that maintains state across restarts. This ensures that working directories and conversation sessions are preserved when the bot restarts, crashes, or is updated.

## What Gets Persisted

### 1. Working Directories ✅
- Channel default directories
- Thread-specific directory overrides  
- DM-specific directories
- Timestamp of when each was set

### 2. Conversation Sessions ✅
- User, channel, and thread identifiers
- Claude Code session IDs for continuity
- Last activity timestamps
- Active/inactive status

### 3. What Does NOT Get Persisted
- Active controllers (runtime only)
- UI state (reactions, message timestamps)
- Temporary todo lists
- File uploads

## File Locations

- **State File**: `./bot-state.json` - Main persistence file
- **Backup File**: `./bot-state.json.backup` - Automatic backup
- **Temp File**: `./bot-state.json.tmp` - Used for atomic writes

## How It Works

### Startup
1. Bot starts and creates `PersistenceManager`
2. Loads existing state from `bot-state.json` (or backup if main is corrupted)
3. `WorkingDirectoryManager` restores all directory configurations
4. `ClaudeHandler` restores all conversation sessions
5. Users can continue where they left off

### During Operation
- State changes are debounced (2-second delay) to prevent excessive writes
- Multiple updates are merged before saving
- Atomic writes ensure data integrity (temp file → backup → rename)
- Automatic cleanup of sessions older than 24 hours

### Shutdown
- State is automatically saved when changes occur
- No explicit save needed on shutdown
- Graceful handling of crashes

## State File Format

```json
{
  "version": "1.0.0",
  "lastUpdated": "2025-08-12T15:00:00.000Z",
  "workingDirectories": {
    "C1234567890": {
      "channelId": "C1234567890",
      "directory": "/Users/dev/project",
      "setAt": "2025-08-12T14:00:00.000Z"
    },
    "C1234567890-1234567890.123456": {
      "channelId": "C1234567890",
      "threadTs": "1234567890.123456",
      "directory": "/Users/dev/other-project",
      "setAt": "2025-08-12T14:30:00.000Z"
    }
  },
  "sessions": {
    "U123456-C1234567890-direct": {
      "userId": "U123456",
      "channelId": "C1234567890",
      "sessionId": "claude-session-uuid",
      "isActive": true,
      "lastActivity": "2025-08-12T14:55:00.000Z"
    }
  }
}
```

## Health Monitoring

The `/status` endpoint now includes persistence statistics:

```bash
curl http://localhost:3001/status | jq '.persistence'
```

Returns:
```json
{
  "workingDirs": 5,
  "sessions": 3,
  "fileExists": true,
  "lastUpdated": "2025-08-12T15:00:00.000Z"
}
```

## Benefits

### For Users
- **No Reconfiguration**: Working directories persist across restarts
- **Conversation Continuity**: Pick up conversations where you left off
- **Reliability**: State survives crashes and deployments

### For Operations
- **Zero Downtime Updates**: Deploy new versions without losing state
- **Debugging**: Human-readable JSON format for troubleshooting
- **Monitoring**: Track active sessions and configurations

## Error Recovery

### Corrupted State File
1. Bot attempts to load main file
2. If corrupted, tries backup file
3. If both fail, starts with empty state
4. Logs all recovery attempts

### Write Failures
- Non-blocking: Persistence failures don't crash the bot
- Logged for monitoring
- Bot continues operating with in-memory state

### Disk Full
- Health check detects write failures
- Bot continues with in-memory state
- Alerts via logs

## Manual Operations

### View Current State
```bash
cat bot-state.json | jq '.'
```

### Check Persistence Health
```bash
curl http://localhost:3001/status | jq '.persistence'
```

### Force Clear State
```bash
# Stop bot first
npm run stop

# Remove state files
rm -f bot-state.json bot-state.json.backup

# Restart
npm run start
```

### Backup State
```bash
cp bot-state.json bot-state-$(date +%Y%m%d).backup.json
```

## Testing

### Unit Test
```bash
node test-persistence.js
```

### Integration Test
1. Set a working directory in Slack
2. Restart the bot
3. Verify directory is remembered
4. Check persistence stats in health endpoint

## Implementation Details

### Debouncing
- 2-second delay after last change
- Multiple updates merged before save
- Prevents disk thrashing

### Atomic Writes
1. Write to `.tmp` file
2. Copy current to `.backup`
3. Rename `.tmp` to main file
4. Ensures no data loss on crash

### Concurrent Updates
- Thread-safe update queue
- Write locking prevents corruption
- Merges pending updates intelligently

## Future Enhancements

Potential improvements:
- Database backend option (PostgreSQL/MongoDB)
- Encryption for sensitive data
- Configurable retention periods
- Export/import functionality
- Migration tools for schema changes