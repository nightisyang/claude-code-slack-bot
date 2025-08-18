import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PersistenceManager, BotState, StateUpdate } from '../src/persistence-manager';

// Simple test framework - avoid external dependencies
class TestRunner {
  private tests: Array<{ name: string; fn: () => Promise<void> | void }> = [];
  private passed = 0;
  private failed = 0;

  test(name: string, fn: () => Promise<void> | void): void {
    this.tests.push({ name, fn });
  }

  async runAll(): Promise<void> {
    console.log(`\n🧪 Running ${this.tests.length} tests...\n`);

    for (const { name, fn } of this.tests) {
      try {
        await fn();
        console.log(`✅ ${name}`);
        this.passed++;
      } catch (error) {
        console.log(`❌ ${name}`);
        console.log(`   Error: ${error instanceof Error ? error.message : error}`);
        this.failed++;
      }
    }

    console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed\n`);
    
    if (this.failed > 0) {
      process.exit(1);
    }
  }
}

// Assertion helpers
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const msg = message || `Expected ${expected}, got ${actual}`;
  assert(actual === expected, msg);
}

function assertExists<T>(value: T | null | undefined, message?: string): asserts value is T {
  assert(value != null, message || 'Value should exist');
}

// Test utilities
function createTempFile(): string {
  return path.join(os.tmpdir(), `test-persistence-${Date.now()}-${Math.random()}.json`);
}

function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (fs.existsSync(`${filePath}.backup`)) fs.unlinkSync(`${filePath}.backup`);
    if (fs.existsSync(`${filePath}.tmp`)) fs.unlinkSync(`${filePath}.tmp`);
    if (fs.existsSync(`${filePath}.test`)) fs.unlinkSync(`${filePath}.test`);
  } catch (error) {
    // Ignore cleanup errors
  }
}

// Test data factories
function createWorkingDirConfig(channelId: string, directory: string, threadTs?: string, userId?: string) {
  return {
    channelId,
    threadTs,
    userId,
    directory,
    setAt: new Date().toISOString()
  };
}

function createSession(userId: string, channelId: string, threadTs?: string, sessionId?: string) {
  return {
    userId,
    channelId,
    threadTs,
    sessionId,
    isActive: true,
    lastActivity: new Date().toISOString()
  };
}

// Test Suite
const runner = new TestRunner();

// Happy Path Tests
runner.test('should create empty state when no file exists', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  const state = persistence.loadState();
  assertExists(state);
  assertEquals(state.version, '1.0.0');
  assertEquals(Object.keys(state.workingDirectories).length, 0);
  assertEquals(Object.keys(state.sessions).length, 0);
  
  cleanupFile(tempFile);
});

runner.test('should save and load working directory config', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  const workingDir = createWorkingDirConfig('C1234567890', '/Users/dev/test-project');
  
  await persistence.forceSave({
    workingDirectories: {
      'C1234567890': workingDir
    }
  });
  
  const state = persistence.loadState();
  assertExists(state);
  assertEquals(Object.keys(state.workingDirectories).length, 1);
  assertEquals(state.workingDirectories['C1234567890'].directory, '/Users/dev/test-project');
  assertEquals(state.workingDirectories['C1234567890'].channelId, 'C1234567890');
  
  cleanupFile(tempFile);
});

runner.test('should save and load session data', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  const session = createSession('U1111111111', 'C1234567890', undefined, 'claude-session-123');
  
  await persistence.forceSave({
    sessions: {
      'U1111111111-C1234567890-direct': session
    }
  });
  
  const state = persistence.loadState();
  assertExists(state);
  assertEquals(Object.keys(state.sessions).length, 1);
  assertEquals(state.sessions['U1111111111-C1234567890-direct'].sessionId, 'claude-session-123');
  assertEquals(state.sessions['U1111111111-C1234567890-direct'].isActive, true);
  
  cleanupFile(tempFile);
});

runner.test('should handle thread-specific working directories', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  const channelDir = createWorkingDirConfig('C1234567890', '/Users/dev/channel-project');
  const threadDir = createWorkingDirConfig('C1234567890', '/Users/dev/thread-project', '1234567890.123456');
  
  await persistence.forceSave({
    workingDirectories: {
      'C1234567890': channelDir,
      'C1234567890-1234567890.123456': threadDir
    }
  });
  
  const state = persistence.loadState();
  assertExists(state);
  assertEquals(Object.keys(state.workingDirectories).length, 2);
  assertEquals(state.workingDirectories['C1234567890'].directory, '/Users/dev/channel-project');
  assertEquals(state.workingDirectories['C1234567890-1234567890.123456'].directory, '/Users/dev/thread-project');
  assertEquals(state.workingDirectories['C1234567890-1234567890.123456'].threadTs, '1234567890.123456');
  
  cleanupFile(tempFile);
});

// Concurrent Updates Tests
runner.test('should merge concurrent working directory updates', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  // Initial state
  await persistence.forceSave({
    workingDirectories: {
      'C1111111111': createWorkingDirConfig('C1111111111', '/initial')
    }
  });
  
  // Simulate concurrent updates from different managers
  const update1: StateUpdate = {
    workingDirectories: {
      'C2222222222': createWorkingDirConfig('C2222222222', '/project-a')
    }
  };
  
  const update2: StateUpdate = {
    workingDirectories: {
      'C3333333333': createWorkingDirConfig('C3333333333', '/project-b')
    }
  };
  
  // Schedule both updates quickly
  persistence.scheduleAutoSave(update1);
  persistence.scheduleAutoSave(update2);
  
  // Force flush
  await persistence.forceSave();
  
  const state = persistence.loadState();
  assertExists(state);
  assertEquals(Object.keys(state.workingDirectories).length, 3);
  assertEquals(state.workingDirectories['C1111111111'].directory, '/initial');
  assertEquals(state.workingDirectories['C2222222222'].directory, '/project-a');
  assertEquals(state.workingDirectories['C3333333333'].directory, '/project-b');
  
  cleanupFile(tempFile);
});

runner.test('should merge sessions and working directories separately', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  // Update from WorkingDirectoryManager
  const workingDirUpdate: StateUpdate = {
    workingDirectories: {
      'C1234567890': createWorkingDirConfig('C1234567890', '/new-project')
    }
  };
  
  // Update from ClaudeHandler  
  const sessionUpdate: StateUpdate = {
    sessions: {
      'U1111111111-C1234567890-direct': createSession('U1111111111', 'C1234567890', undefined, 'claude-123')
    }
  };
  
  // Both update concurrently
  persistence.scheduleAutoSave(workingDirUpdate);
  persistence.scheduleAutoSave(sessionUpdate);
  
  await persistence.forceSave();
  
  const state = persistence.loadState();
  assertExists(state);
  assertEquals(Object.keys(state.workingDirectories).length, 1);
  assertEquals(Object.keys(state.sessions).length, 1);
  assertEquals(state.workingDirectories['C1234567890'].directory, '/new-project');
  assertEquals(state.sessions['U1111111111-C1234567890-direct'].sessionId, 'claude-123');
  
  cleanupFile(tempFile);
});

runner.test('should handle rapid cwd updates correctly', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  // Simulate rapid cwd changes in same channel
  const updates = [
    { workingDirectories: { 'C1234567890': createWorkingDirConfig('C1234567890', '/project-1') } },
    { workingDirectories: { 'C1234567890': createWorkingDirConfig('C1234567890', '/project-2') } },
    { workingDirectories: { 'C1234567890': createWorkingDirConfig('C1234567890', '/project-3') } },
  ];
  
  // Schedule all updates rapidly
  updates.forEach(update => persistence.scheduleAutoSave(update));
  
  await persistence.forceSave();
  
  const state = persistence.loadState();
  assertExists(state);
  assertEquals(Object.keys(state.workingDirectories).length, 1);
  assertEquals(state.workingDirectories['C1234567890'].directory, '/project-3'); // Last update wins
  
  cleanupFile(tempFile);
});

// Error Handling Tests  
runner.test('should recover from corrupted main file using backup', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  // Create valid backup
  const validState: BotState = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    workingDirectories: {
      'C1234567890': createWorkingDirConfig('C1234567890', '/backup-recovery')
    },
    sessions: {}
  };
  
  fs.writeFileSync(`${tempFile}.backup`, JSON.stringify(validState));
  
  // Create corrupted main file
  fs.writeFileSync(tempFile, 'invalid json{');
  
  const state = persistence.loadState();
  assertExists(state);
  assertEquals(state.workingDirectories['C1234567890'].directory, '/backup-recovery');
  assert(fs.existsSync(tempFile), 'Main file should be restored from backup');
  
  cleanupFile(tempFile);
});

runner.test('should handle missing directories gracefully', async () => {
  const nonExistentPath = '/this/path/does/not/exist/state.json';
  const persistence = new PersistenceManager(nonExistentPath);
  
  // Should not throw
  const state = persistence.loadState();
  assertExists(state);
  assertEquals(state.version, '1.0.0');
  assertEquals(Object.keys(state.workingDirectories).length, 0);
});

runner.test('should handle write permission errors gracefully', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  // Create directory with same name to cause write error
  fs.mkdirSync(tempFile);
  
  // Should not throw
  await persistence.forceSave({
    workingDirectories: {
      'test': createWorkingDirConfig('test', '/test')
    }
  });
  
  // Health check should fail
  assertEquals(persistence.isHealthy(), false);
  
  // Cleanup
  fs.rmSync(tempFile, { recursive: true });
});

// Cleanup Tests
runner.test('should cleanup old sessions', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago
  const recentDate = new Date().toISOString();
  
  const oldSession = createSession('U1111111111', 'C1234567890');
  oldSession.lastActivity = oldDate;
  
  const recentSession = createSession('U2222222222', 'C1234567890');
  recentSession.lastActivity = recentDate;
  
  await persistence.forceSave({
    sessions: {
      'old-session': oldSession,
      'recent-session': recentSession
    }
  });
  
  // Cleanup sessions older than 24 hours
  persistence.cleanupOldSessions(24 * 60 * 60 * 1000);
  await persistence.forceSave(); // Force flush cleanup
  
  const state = persistence.loadState();
  assertExists(state);
  assertEquals(Object.keys(state.sessions).length, 1);
  assert('recent-session' in state.sessions, 'Recent session should remain');
  assert(!('old-session' in state.sessions), 'Old session should be removed');
  
  cleanupFile(tempFile);
});

// Atomic Write Tests
runner.test('should perform atomic writes', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  // Initial save
  await persistence.forceSave({
    workingDirectories: {
      'C1234567890': createWorkingDirConfig('C1234567890', '/initial')
    }
  });
  
  // Verify backup was created during update
  await persistence.forceSave({
    workingDirectories: {
      'C1234567890': createWorkingDirConfig('C1234567890', '/updated')
    }
  });
  
  assert(fs.existsSync(`${tempFile}.backup`), 'Backup file should exist');
  
  // Verify backup contains previous state
  const backupContent = JSON.parse(fs.readFileSync(`${tempFile}.backup`, 'utf8'));
  assertEquals(backupContent.workingDirectories['C1234567890'].directory, '/initial');
  
  cleanupFile(tempFile);
});

// Statistics Tests
runner.test('should provide accurate statistics', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  await persistence.forceSave({
    workingDirectories: {
      'C1': createWorkingDirConfig('C1', '/test1'),
      'C2': createWorkingDirConfig('C2', '/test2')
    },
    sessions: {
      'S1': createSession('U1', 'C1'),
      'S2': createSession('U2', 'C2'),
      'S3': createSession('U3', 'C1')
    }
  });
  
  const stats = persistence.getStats();
  assertEquals(stats.workingDirs, 2);
  assertEquals(stats.sessions, 3);
  assertEquals(stats.fileExists, true);
  assertExists(stats.lastUpdated);
  
  cleanupFile(tempFile);
});

// Run all tests
if (require.main === module) {
  runner.runAll().catch(console.error);
}

export { runner as testRunner };