# Persistence Implementation Plan

## Overview
Add JSON file-based persistence to maintain bot state across restarts. This will preserve working directory configurations and conversation sessions without requiring a database.

## What Needs Persistence

### 1. Working Directory Configurations (HIGH PRIORITY)
**Current State:** `src/working-directory-manager.ts:8`
```typescript
private configs: Map<string, WorkingDirectoryConfig> = new Map();
```
**Data:** Channel and thread-specific working directories that users configure with `cwd` commands.

### 2. Conversation Sessions (MEDIUM PRIORITY)  
**Current State:** `src/claude-handler.ts:7`
```typescript
private sessions: Map<string, ConversationSession> = new Map();
```
**Data:** Claude Code session IDs for conversation continuity.

### 3. Runtime State (LOW PRIORITY - Don't Persist)
- `activeControllers`: AbortController instances (runtime only)
- `todoMessages`: Message timestamps (ephemeral UI state)
- `originalMessages`: Original message info (ephemeral UI state)  
- `currentReactions`: Current emoji reactions (ephemeral UI state)

## JSON File Structure

### `bot-state.json`
```json
{
  "version": "1.0.0",
  "lastUpdated": "2024-01-15T10:30:00.000Z",
  "workingDirectories": {
    "C1234567890": {
      "channelId": "C1234567890",
      "directory": "/Users/dev/Code/main-project",
      "setAt": "2024-01-15T09:00:00.000Z"
    },
    "C1234567890-1234567890.123456": {
      "channelId": "C1234567890", 
      "threadTs": "1234567890.123456",
      "directory": "/Users/dev/Code/thread-specific-project",
      "setAt": "2024-01-15T10:00:00.000Z"
    },
    "D9876543210-U1111111111": {
      "channelId": "D9876543210",
      "userId": "U1111111111", 
      "directory": "/Users/dev/Code/dm-project",
      "setAt": "2024-01-15T10:15:00.000Z"
    }
  },
  "sessions": {
    "U1111111111-C1234567890-direct": {
      "userId": "U1111111111",
      "channelId": "C1234567890",
      "sessionId": "claude-session-uuid-here",
      "isActive": true,
      "lastActivity": "2024-01-15T10:25:00.000Z"
    },
    "U1111111111-C1234567890-1234567890.123456": {
      "userId": "U1111111111", 
      "channelId": "C1234567890",
      "threadTs": "1234567890.123456",
      "sessionId": "claude-session-uuid-thread",
      "isActive": true,
      "lastActivity": "2024-01-15T10:29:00.000Z"
    }
  }
}
```

## Implementation Architecture

### 1. New Persistence Manager (`src/persistence-manager.ts`)
```typescript
export class PersistenceManager {
  private filePath: string = './bot-state.json';
  private logger = new Logger('PersistenceManager');
  
  // Load state from JSON file
  loadState(): BotState | null
  
  // Save state to JSON file  
  saveState(state: BotState): void
  
  // Auto-save with debouncing
  scheduleAutoSave(state: BotState): void
}

export interface BotState {
  version: string;
  lastUpdated: string;
  workingDirectories: Record<string, WorkingDirectoryConfig>;
  sessions: Record<string, ConversationSession>;
}
```

### 2. Enhanced Type Definitions (`src/types.ts`)
```typescript
export interface WorkingDirectoryConfig {
  channelId: string;
  threadTs?: string;
  userId?: string; 
  directory: string;
  setAt: Date;
}

export interface ConversationSession {
  userId: string;
  channelId: string;
  threadTs?: string;
  sessionId?: string;
  isActive: boolean;
  lastActivity: Date;
}

// Add serialization helpers
export interface SerializedWorkingDirectoryConfig {
  channelId: string;
  threadTs?: string;
  userId?: string;
  directory: string; 
  setAt: string; // ISO date string
}

export interface SerializedConversationSession {
  userId: string;
  channelId: string;
  threadTs?: string;
  sessionId?: string;
  isActive: boolean;
  lastActivity: string; // ISO date string
}
```

## Code Changes Required

### 1. WorkingDirectoryManager (`src/working-directory-manager.ts`)

**Add persistence integration:**
```typescript
export class WorkingDirectoryManager {
  private configs: Map<string, WorkingDirectoryConfig> = new Map();
  private logger = new Logger('WorkingDirectoryManager');
  private persistenceManager: PersistenceManager; // ADD THIS

  constructor(persistenceManager: PersistenceManager) { // MODIFY CONSTRUCTOR
    this.persistenceManager = persistenceManager;
    this.loadPersistedConfigs(); // LOAD ON STARTUP
  }

  // ADD METHOD
  private loadPersistedConfigs(): void {
    const state = this.persistenceManager.loadState();
    if (state?.workingDirectories) {
      for (const [key, config] of Object.entries(state.workingDirectories)) {
        this.configs.set(key, {
          ...config,
          setAt: new Date(config.setAt) // Convert string back to Date
        });
      }
      this.logger.info('Loaded persisted working directories', { 
        count: Object.keys(state.workingDirectories).length 
      });
    }
  }

  // MODIFY METHOD - Add persistence after setting
  setWorkingDirectory(channelId: string, directory: string, threadTs?: string, userId?: string) {
    // ... existing logic ...
    
    this.configs.set(key, workingDirConfig);
    this.saveState(); // ADD THIS LINE
    
    // ... rest of method
  }

  // MODIFY METHOD - Add persistence after removal  
  removeWorkingDirectory(channelId: string, threadTs?: string, userId?: string): boolean {
    const result = this.configs.delete(key);
    if (result) {
      this.saveState(); // ADD THIS LINE
    }
    return result;
  }

  // ADD METHOD
  private saveState(): void {
    const workingDirectories: Record<string, any> = {};
    for (const [key, config] of this.configs.entries()) {
      workingDirectories[key] = {
        ...config,
        setAt: config.setAt.toISOString() // Convert Date to string
      };
    }
    
    this.persistenceManager.scheduleAutoSave({
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      workingDirectories,
      sessions: {} // Will be populated by ClaudeHandler
    });
  }
}
```

### 2. ClaudeHandler (`src/claude-handler.ts`)

**Add persistence integration:**
```typescript
export class ClaudeHandler {
  private sessions: Map<string, ConversationSession> = new Map();
  private logger = new Logger('ClaudeHandler');
  private mcpManager: McpManager;
  private persistenceManager: PersistenceManager; // ADD THIS

  constructor(mcpManager: McpManager, persistenceManager: PersistenceManager) { // MODIFY
    this.mcpManager = mcpManager;
    this.persistenceManager = persistenceManager;
    this.loadPersistedSessions(); // ADD THIS
  }

  // ADD METHOD
  private loadPersistedSessions(): void {
    const state = this.persistenceManager.loadState();
    if (state?.sessions) {
      for (const [key, session] of Object.entries(state.sessions)) {
        this.sessions.set(key, {
          ...session,
          lastActivity: new Date(session.lastActivity) // Convert string back to Date
        });
      }
      this.logger.info('Loaded persisted sessions', { 
        count: Object.keys(state.sessions).length 
      });
    }
  }

  // MODIFY METHOD - Add persistence after session creation/update
  createSession(userId: string, channelId: string, threadTs?: string): ConversationSession {
    // ... existing logic ...
    this.sessions.set(this.getSessionKey(userId, channelId, threadTs), session);
    this.saveState(); // ADD THIS LINE
    return session;
  }

  // ADD METHOD - Called from streamQuery when sessionId is set
  updateSessionId(sessionKey: string, sessionId: string): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.sessionId = sessionId;
      session.lastActivity = new Date();
      this.saveState(); // PERSIST THE UPDATE
    }
  }

  // MODIFY METHOD - Update session activity and persist
  updateLastActivity(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.lastActivity = new Date();
      this.saveState();
    }
  }

  // ADD METHOD
  private saveState(): void {
    const sessions: Record<string, any> = {};
    for (const [key, session] of this.sessions.entries()) {
      sessions[key] = {
        ...session,
        lastActivity: session.lastActivity.toISOString() // Convert Date to string
      };
    }
    
    this.persistenceManager.scheduleAutoSave({
      version: '1.0.0', 
      lastUpdated: new Date().toISOString(),
      workingDirectories: {}, // Will be populated by WorkingDirectoryManager
      sessions
    });
  }
}
```

### 3. Main Application (`src/index.ts`)

**Wire up persistence manager:**
```typescript
async function start() {
  try {
    validateConfig();

    // Initialize persistence manager
    const persistenceManager = new PersistenceManager(); // ADD THIS

    // Initialize Slack app
    const app = new App({
      token: config.slack.botToken,
      signingSecret: config.slack.signingSecret, 
      socketMode: true,
      appToken: config.slack.appToken,
    });

    // Initialize MCP manager
    const mcpManager = new McpManager();

    // Initialize handlers WITH persistence manager
    const claudeHandler = new ClaudeHandler(mcpManager, persistenceManager); // MODIFY
    const slackHandler = new SlackHandler(app, claudeHandler, mcpManager, persistenceManager); // MODIFY

    // ... rest of startup
  }
}
```

### 4. SlackHandler (`src/slack-handler.ts`)

**Add persistence integration:**
```typescript
export class SlackHandler {
  // ... existing properties ...
  private persistenceManager: PersistenceManager; // ADD THIS

  constructor(app: App, claudeHandler: ClaudeHandler, mcpManager: McpManager, persistenceManager: PersistenceManager) { // MODIFY
    // ... existing assignments ...
    this.persistenceManager = persistenceManager;
    this.workingDirManager = new WorkingDirectoryManager(persistenceManager); // PASS PERSISTENCE
  }

  // MODIFY handleMessage to update session activity
  async handleMessage(event: MessageEvent, say: any) {
    // ... existing logic up to session creation ...

    // After getting/creating session, update activity
    if (session) {
      this.claudeHandler.updateLastActivity(sessionKey); // ADD THIS
    }

    // ... rest of method
  }
}
```

## Auto-Save Strategy

### Debounced Persistence
- Save state 2 seconds after last change
- Prevent excessive file writes during rapid operations
- Graceful error handling if file write fails

### Implementation in PersistenceManager:
```typescript
export class PersistenceManager {
  private saveTimeout: NodeJS.Timeout | null = null;
  private pendingState: BotState | null = null;

  scheduleAutoSave(state: BotState): void {
    this.pendingState = { ...this.pendingState, ...state };
    
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    
    this.saveTimeout = setTimeout(() => {
      if (this.pendingState) {
        this.saveState(this.pendingState);
        this.pendingState = null;
      }
    }, 2000); // 2 second debounce
  }
}
```

## Error Handling & Recovery

### File Corruption Protection
1. **Atomic Writes**: Write to temporary file, then rename
2. **Backup Creation**: Keep last known good state as `.backup`
3. **Validation**: JSON schema validation on load
4. **Fallback**: Continue with empty state if file corrupted

### Session Cleanup  
- Remove sessions older than 24 hours on startup
- Remove invalid Claude Code sessions that no longer exist

## Migration Strategy

### Phase 1: Working Directories Only
- Implement persistence for working directories first
- High user impact, simple data structure
- Test thoroughly before adding session persistence

### Phase 2: Add Session Persistence
- Add conversation session persistence
- More complex due to Claude Code integration
- Requires testing session resume functionality

## File Locations
- **State File**: `./bot-state.json` (gitignored)
- **Backup File**: `./bot-state.json.backup` (gitignored)
- **New Source**: `./src/persistence-manager.ts`

## Testing Considerations
- Test bot restart with existing state file
- Test state file corruption scenarios
- Test concurrent state updates
- Verify Claude Code session resume works correctly
- Test working directory inheritance (thread > channel > DM)

## Benefits After Implementation
1. **User Experience**: No need to reconfigure working directories after restarts
2. **Conversation Continuity**: Resume conversations where they left off  
3. **Reliability**: Bot state survives crashes and deployments
4. **Simple Maintenance**: JSON files are human-readable and debuggable