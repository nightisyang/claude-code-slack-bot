import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PersistenceManager, StateUpdate } from '../src/persistence-manager';

// Simple test framework
class IntegrationTestRunner {
  private tests: Array<{ name: string; fn: () => Promise<void> | void }> = [];
  private passed = 0;
  private failed = 0;

  test(name: string, fn: () => Promise<void> | void): void {
    this.tests.push({ name, fn });
  }

  async runAll(): Promise<void> {
    console.log(`\n🔧 Running ${this.tests.length} integration tests...\n`);

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

    console.log(`\n📊 Integration Results: ${this.passed} passed, ${this.failed} failed\n`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const msg = message || `Expected ${expected}, got ${actual}`;
  assert(actual === expected, msg);
}

function createTempFile(): string {
  return path.join(os.tmpdir(), `integration-test-${Date.now()}-${Math.random()}.json`);
}

function cleanupFile(filePath: string): void {
  try {
    [filePath, `${filePath}.backup`, `${filePath}.tmp`, `${filePath}.test`].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
  } catch (error) {
    // Ignore cleanup errors
  }
}

// Mock managers to simulate how they would use persistence
class MockWorkingDirectoryManager {
  private persistence: PersistenceManager;
  
  constructor(persistence: PersistenceManager) {
    this.persistence = persistence;
  }

  setWorkingDirectory(channelId: string, directory: string, threadTs?: string, userId?: string): void {
    const key = this.getConfigKey(channelId, threadTs, userId);
    
    this.persistence.scheduleAutoSave({
      workingDirectories: {
        [key]: {
          channelId,
          threadTs,
          userId,
          directory,
          setAt: new Date().toISOString()
        }
      }
    });
  }

  private getConfigKey(channelId: string, threadTs?: string, userId?: string): string {
    if (threadTs) {
      return `${channelId}-${threadTs}`;
    }
    if (userId && channelId.startsWith('D')) {
      return `${channelId}-${userId}`;
    }
    return channelId;
  }
}

class MockClaudeHandler {
  private persistence: PersistenceManager;
  
  constructor(persistence: PersistenceManager) {
    this.persistence = persistence;
  }

  createSession(userId: string, channelId: string, threadTs?: string): void {
    const sessionKey = `${userId}-${channelId}-${threadTs || 'direct'}`;
    
    this.persistence.scheduleAutoSave({
      sessions: {
        [sessionKey]: {
          userId,
          channelId,
          threadTs,
          sessionId: `claude-session-${Date.now()}`,
          isActive: true,
          lastActivity: new Date().toISOString()
        }
      }
    });
  }

  updateSessionActivity(userId: string, channelId: string, threadTs?: string): void {
    const sessionKey = `${userId}-${channelId}-${threadTs || 'direct'}`;
    
    this.persistence.scheduleAutoSave({
      sessions: {
        [sessionKey]: {
          userId,
          channelId,
          threadTs,
          sessionId: `claude-session-${Date.now()}`,
          isActive: true,
          lastActivity: new Date().toISOString()
        }
      }
    });
  }
}

const runner = new IntegrationTestRunner();

// Real-world scenarios from the user's question about cwd updates

runner.test('Scenario: User sets channel default, then thread override', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  const workingDirManager = new MockWorkingDirectoryManager(persistence);

  // User sets channel default
  workingDirManager.setWorkingDirectory('C1234567890', '/Users/dev/main-project');
  
  // Later, user sets thread-specific directory
  workingDirManager.setWorkingDirectory('C1234567890', '/Users/dev/feature-branch', '1234567890.123456');
  
  // Force flush all updates
  await persistence.forceSave();
  
  const state = persistence.loadState();
  assert(state !== null, 'State should be loaded');
  
  // Both should exist
  assertEquals(Object.keys(state.workingDirectories).length, 2);
  assertEquals(state.workingDirectories['C1234567890'].directory, '/Users/dev/main-project');
  assertEquals(state.workingDirectories['C1234567890-1234567890.123456'].directory, '/Users/dev/feature-branch');
  
  cleanupFile(tempFile);
});

runner.test('Scenario: Concurrent updates from WorkingDirManager and ClaudeHandler', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  const workingDirManager = new MockWorkingDirectoryManager(persistence);
  const claudeHandler = new MockClaudeHandler(persistence);

  // Simulate concurrent operations happening at same time
  // User sets working directory
  workingDirManager.setWorkingDirectory('C1234567890', '/Users/dev/project-x');
  
  // At same time, Claude creates a session (different part of state)
  claudeHandler.createSession('U1111111111', 'C1234567890');
  
  // And user also sets a DM directory
  workingDirManager.setWorkingDirectory('D9876543210', '/Users/dev/dm-project', undefined, 'U1111111111');

  // Force flush - should merge all updates
  await persistence.forceSave();
  
  const state = persistence.loadState();
  assert(state !== null, 'State should be loaded');
  
  // All updates should be preserved
  assertEquals(Object.keys(state.workingDirectories).length, 2);
  assertEquals(Object.keys(state.sessions).length, 1);
  
  assertEquals(state.workingDirectories['C1234567890'].directory, '/Users/dev/project-x');
  assertEquals(state.workingDirectories['D9876543210-U1111111111'].directory, '/Users/dev/dm-project');
  assertEquals(state.sessions['U1111111111-C1234567890-direct'].userId, 'U1111111111');
  
  cleanupFile(tempFile);
});

runner.test('Scenario: Rapid cwd changes during active conversation', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  const workingDirManager = new MockWorkingDirectoryManager(persistence);
  const claudeHandler = new MockClaudeHandler(persistence);

  // User starts conversation
  claudeHandler.createSession('U1111111111', 'C1234567890');
  
  // User rapidly changes working directory multiple times
  workingDirManager.setWorkingDirectory('C1234567890', '/Users/dev/project-1');
  workingDirManager.setWorkingDirectory('C1234567890', '/Users/dev/project-2');
  workingDirManager.setWorkingDirectory('C1234567890', '/Users/dev/final-project');
  
  // Session activity continues
  claudeHandler.updateSessionActivity('U1111111111', 'C1234567890');
  
  await persistence.forceSave();
  
  const state = persistence.loadState();
  assert(state !== null, 'State should be loaded');
  
  // Should have final directory (last update wins)
  assertEquals(state.workingDirectories['C1234567890'].directory, '/Users/dev/final-project');
  
  // Session should still exist
  assertEquals(Object.keys(state.sessions).length, 1);
  assert(state.sessions['U1111111111-C1234567890-direct'], 'Session should exist');
  
  cleanupFile(tempFile);
});

runner.test('Scenario: Bot restart recovery simulation', async () => {
  const tempFile = createTempFile();
  
  // Phase 1: Initial bot run
  {
    const persistence = new PersistenceManager(tempFile);
    const workingDirManager = new MockWorkingDirectoryManager(persistence);
    const claudeHandler = new MockClaudeHandler(persistence);

    // User sets up working directories and has conversations
    workingDirManager.setWorkingDirectory('C1234567890', '/Users/dev/main-project');
    workingDirManager.setWorkingDirectory('C1234567890', '/Users/dev/thread-work', '1234567890.123456');
    workingDirManager.setWorkingDirectory('D9876543210', '/Users/dev/personal', undefined, 'U1111111111');
    
    claudeHandler.createSession('U1111111111', 'C1234567890');
    claudeHandler.createSession('U1111111111', 'C1234567890', '1234567890.123456');
    
    await persistence.forceSave();
  }
  
  // Phase 2: Bot restarts (new instances)
  {
    const persistence = new PersistenceManager(tempFile);
    
    const state = persistence.loadState();
    assert(state !== null, 'State should be recovered after restart');
    
    // All configurations should be preserved
    assertEquals(Object.keys(state.workingDirectories).length, 3);
    assertEquals(Object.keys(state.sessions).length, 2);
    
    // Verify specific data
    assertEquals(state.workingDirectories['C1234567890'].directory, '/Users/dev/main-project');
    assertEquals(state.workingDirectories['C1234567890-1234567890.123456'].directory, '/Users/dev/thread-work');
    assertEquals(state.workingDirectories['D9876543210-U1111111111'].directory, '/Users/dev/personal');
    
    assert(state.sessions['U1111111111-C1234567890-direct'], 'Channel session should exist');
    assert(state.sessions['U1111111111-C1234567890-1234567890.123456'], 'Thread session should exist');
  }
  
  cleanupFile(tempFile);
});

runner.test('Scenario: Race condition handling', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);

  // Simulate race condition: multiple managers trying to save at exact same time
  const updates: Promise<void>[] = [];
  
  // Fire off multiple concurrent saves
  for (let i = 0; i < 10; i++) {
    const update = persistence.forceSave({
      workingDirectories: {
        [`C${i}`]: {
          channelId: `C${i}`,
          directory: `/project-${i}`,
          setAt: new Date().toISOString()
        }
      }
    });
    updates.push(update);
  }
  
  // Wait for all to complete
  await Promise.all(updates);
  
  const state = persistence.loadState();
  assert(state !== null, 'State should be loaded');
  
  // All updates should be preserved despite race conditions
  assertEquals(Object.keys(state.workingDirectories).length, 10);
  
  for (let i = 0; i < 10; i++) {
    assertEquals(state.workingDirectories[`C${i}`].directory, `/project-${i}`);
  }
  
  cleanupFile(tempFile);
});

runner.test('Scenario: File corruption during active use', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  // Set up initial state
  await persistence.forceSave({
    workingDirectories: {
      'C1234567890': {
        channelId: 'C1234567890',
        directory: '/initial-project',
        setAt: new Date().toISOString()
      }
    }
  });
  
  // Make a second save to ensure backup is created
  await persistence.forceSave({
    workingDirectories: {
      'C1234567890': {
        channelId: 'C1234567890',
        directory: '/initial-project',
        setAt: new Date().toISOString()
      }
    }
  });
  
  // Corrupt the main file
  fs.writeFileSync(tempFile, 'corrupted{invalid:json}');
  
  // Next operation should recover from backup
  const state = persistence.loadState();
  assert(state !== null, 'Should recover from backup');
  assertEquals(state.workingDirectories['C1234567890'].directory, '/initial-project');
  
  // New saves should work fine
  await persistence.forceSave({
    workingDirectories: {
      'C2222222222': {
        channelId: 'C2222222222',
        directory: '/recovery-project',
        setAt: new Date().toISOString()
      }
    }
  });
  
  const recoveredState = persistence.loadState();
  assert(recoveredState !== null, 'Should load recovered state');
  assertEquals(Object.keys(recoveredState.workingDirectories).length, 2);
  
  cleanupFile(tempFile);
});

runner.test('Scenario: High-frequency cwd updates (stress test)', async () => {
  const tempFile = createTempFile();
  const persistence = new PersistenceManager(tempFile);
  
  const startTime = Date.now();
  
  // Rapid-fire 50 directory changes
  const updates: Promise<void>[] = [];
  for (let i = 0; i < 50; i++) {
    const update = persistence.forceSave({
      workingDirectories: {
        'C1234567890': {
          channelId: 'C1234567890',
          directory: `/rapid-update-${i}`,
          setAt: new Date().toISOString()
        }
      }
    });
    updates.push(update);
  }
  
  await Promise.all(updates);
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  console.log(`   ⚡ Completed 50 rapid updates in ${duration}ms`);
  
  const state = persistence.loadState();
  assert(state !== null, 'State should exist after stress test');
  assertEquals(state.workingDirectories['C1234567890'].directory, '/rapid-update-49');
  
  // Performance assertion: should complete in reasonable time
  assert(duration < 5000, `Stress test took too long: ${duration}ms`);
  
  cleanupFile(tempFile);
});

// Export for running
export { runner as integrationTestRunner };

// Run tests if called directly
if (require.main === module) {
  runner.runAll().catch(console.error);
}