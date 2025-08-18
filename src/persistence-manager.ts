import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger.js';

// Standalone types - don't import from types.ts to avoid integration issues
export interface BotState {
  version: string;
  lastUpdated: string;
  workingDirectories: Record<string, SerializedWorkingDirectoryConfig>;
  sessions: Record<string, SerializedConversationSession>;
}

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

export interface StateUpdate {
  workingDirectories?: Record<string, SerializedWorkingDirectoryConfig>;
  sessions?: Record<string, SerializedConversationSession>;
}

export class PersistenceManager {
  private filePath: string;
  private backupPath: string;
  private logger = new Logger('PersistenceManager');
  private saveTimeout: NodeJS.Timeout | null = null;
  private pendingUpdates: StateUpdate[] = [];
  private isWriting = false;
  private writeLock: Promise<void> | null = null;

  constructor(filePath: string = './bot-state.json') {
    this.filePath = path.resolve(filePath);
    this.backupPath = `${this.filePath}.backup`;
  }

  /**
   * Load bot state from file with error recovery
   */
  loadState(): BotState | null {
    try {
      // Try to load main state file
      if (fs.existsSync(this.filePath)) {
        const state = this.loadAndValidateFile(this.filePath);
        if (state) {
          this.logger.info('Loaded bot state', {
            workingDirs: Object.keys(state.workingDirectories).length,
            sessions: Object.keys(state.sessions).length,
            lastUpdated: state.lastUpdated
          });
          return state;
        }
      }

      // Try backup file if main file failed
      if (fs.existsSync(this.backupPath)) {
        this.logger.warn('Main state file corrupted, trying backup');
        const state = this.loadAndValidateFile(this.backupPath);
        if (state) {
          // Restore backup as main file
          fs.copyFileSync(this.backupPath, this.filePath);
          this.logger.info('Restored state from backup');
          return state;
        }
      }

      this.logger.info('No valid state file found, starting fresh');
      return this.getEmptyState();

    } catch (error) {
      this.logger.error('Error loading state', error);
      return this.getEmptyState();
    }
  }

  /**
   * Schedule auto-save with debouncing and state merging
   * This handles concurrent updates by merging them before saving
   */
  scheduleAutoSave(update: StateUpdate): void {
    this.pendingUpdates.push(update);
    
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    
    this.saveTimeout = setTimeout(async () => {
      await this.flushPendingUpdates();
    }, 2000); // 2 second debounce
  }

  /**
   * Force immediate save (useful for tests or shutdown)
   */
  async forceSave(update?: StateUpdate): Promise<void> {
    if (update) {
      this.pendingUpdates.push(update);
    }
    
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    
    await this.flushPendingUpdates();
  }

  /**
   * Flush all pending updates with write locking
   */
  private async flushPendingUpdates(): Promise<void> {
    if (this.isWriting) {
      // If already writing, wait for it to complete then try again
      if (this.writeLock) {
        await this.writeLock;
        return this.flushPendingUpdates();
      }
      return;
    }

    if (this.pendingUpdates.length === 0) {
      return;
    }

    this.isWriting = true;
    this.writeLock = this.performSave();
    
    try {
      await this.writeLock;
    } finally {
      this.isWriting = false;
      this.writeLock = null;
    }
  }

  /**
   * Perform the actual save operation with atomic writes
   */
  private async performSave(): Promise<void> {
    try {
      // Load current state
      const currentState = this.loadState() || this.getEmptyState();
      
      // Merge all pending updates
      const mergedState = this.mergeUpdates(currentState, this.pendingUpdates);
      this.pendingUpdates = []; // Clear pending updates
      
      // Update timestamp
      mergedState.lastUpdated = new Date().toISOString();
      
      // Atomic write: temp file -> backup -> rename
      const tempPath = `${this.filePath}.tmp`;
      
      // Write to temp file
      fs.writeFileSync(tempPath, JSON.stringify(mergedState, null, 2), 'utf8');
      
      // Create backup if main file exists
      if (fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, this.backupPath);
      }
      
      // Atomic rename
      fs.renameSync(tempPath, this.filePath);
      
      this.logger.debug('State saved successfully', {
        workingDirs: Object.keys(mergedState.workingDirectories).length,
        sessions: Object.keys(mergedState.sessions).length,
        pendingUpdates: this.pendingUpdates.length
      });

    } catch (error) {
      this.logger.error('Failed to save state', error);
      // Don't throw - persistence failure shouldn't crash the bot
    }
  }

  /**
   * Merge multiple state updates intelligently
   * Later updates override earlier ones for the same keys
   */
  private mergeUpdates(currentState: BotState, updates: StateUpdate[]): BotState {
    const result: BotState = {
      ...currentState,
      workingDirectories: { ...currentState.workingDirectories },
      sessions: { ...currentState.sessions }
    };

    for (const update of updates) {
      // Merge working directories
      if (update.workingDirectories) {
        // Check if this is a complete replacement (used by cleanup)
        if (Object.keys(update.workingDirectories).length === 0 || 
            update.workingDirectories['__REPLACE_ALL__']) {
          result.workingDirectories = { ...update.workingDirectories };
          delete result.workingDirectories['__REPLACE_ALL__'];
        } else {
          for (const [key, config] of Object.entries(update.workingDirectories)) {
            if (config === null || config === undefined) {
              delete result.workingDirectories[key];
            } else {
              result.workingDirectories[key] = config;
            }
          }
        }
      }

      // Merge sessions
      if (update.sessions) {
        // Check if this is a complete replacement (used by cleanup)
        if (update.sessions['__REPLACE_ALL__']) {
          result.sessions = { ...update.sessions };
          delete result.sessions['__REPLACE_ALL__'];
        } else {
          for (const [key, session] of Object.entries(update.sessions)) {
            if (session === null || session === undefined) {
              delete result.sessions[key];
            } else {
              result.sessions[key] = session;
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Load and validate a specific file
   */
  private loadAndValidateFile(filePath: string): BotState | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      
      // Basic validation
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid JSON structure');
      }
      
      // Ensure required fields exist
      const state: BotState = {
        version: parsed.version || '1.0.0',
        lastUpdated: parsed.lastUpdated || new Date().toISOString(),
        workingDirectories: parsed.workingDirectories || {},
        sessions: parsed.sessions || {}
      };
      
      // Validate structure
      if (typeof state.workingDirectories !== 'object' || 
          typeof state.sessions !== 'object') {
        throw new Error('Invalid state structure');
      }
      
      return state;
      
    } catch (error) {
      this.logger.warn(`Failed to load state file ${filePath}`, error);
      return null;
    }
  }

  /**
   * Get empty initial state
   */
  private getEmptyState(): BotState {
    return {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      workingDirectories: {},
      sessions: {}
    };
  }

  /**
   * Remove working directory from state
   */
  removeWorkingDirectory(key: string): void {
    this.scheduleAutoSave({
      workingDirectories: { [key]: null as any }
    });
  }

  /**
   * Remove session from state
   */
  removeSession(key: string): void {
    this.scheduleAutoSave({
      sessions: { [key]: null as any }
    });
  }

  /**
   * Clean up old sessions (older than maxAge milliseconds)
   */
  cleanupOldSessions(maxAge: number = 24 * 60 * 60 * 1000): void {
    const state = this.loadState();
    if (!state) return;

    const now = Date.now();
    const cleanedSessions: Record<string, SerializedConversationSession> = { '__REPLACE_ALL__': true as any };
    let removedCount = 0;

    for (const [key, session] of Object.entries(state.sessions)) {
      const lastActivity = new Date(session.lastActivity).getTime();
      if (now - lastActivity < maxAge) {
        cleanedSessions[key] = session;
      } else {
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.info(`Cleaned up ${removedCount} old sessions`);
      this.scheduleAutoSave({ sessions: cleanedSessions });
    }
  }

  /**
   * Get current file path (useful for tests)
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Check if persistence is working
   */
  isHealthy(): boolean {
    try {
      // Check if main file path is blocked by directory
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        if (stats.isDirectory()) {
          return false; // Can't write file if directory exists with same name
        }
      }

      // Check if the directory exists and is writable
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        return false;
      }
      
      const dirStats = fs.statSync(dir);
      if (!dirStats.isDirectory()) {
        return false;
      }

      // Try to write a test file
      const testPath = `${this.filePath}.test`;
      fs.writeFileSync(testPath, '{}');
      fs.unlinkSync(testPath);
      return true;
    } catch (error) {
      this.logger.warn('Persistence health check failed', error);
      return false;
    }
  }

  /**
   * Get statistics about current state
   */
  getStats(): { workingDirs: number; sessions: number; fileExists: boolean; lastUpdated?: string } {
    const state = this.loadState();
    return {
      workingDirs: state ? Object.keys(state.workingDirectories).length : 0,
      sessions: state ? Object.keys(state.sessions).length : 0,
      fileExists: fs.existsSync(this.filePath),
      lastUpdated: state?.lastUpdated
    };
  }
}