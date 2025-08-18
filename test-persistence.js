#!/usr/bin/env node

// Quick test to verify persistence works
const { PersistenceManager } = require('./dist/persistence-manager.js');

async function test() {
  console.log('Testing persistence...\n');
  
  const pm = new PersistenceManager('./test-bot-state.json');
  
  // Test 1: Check empty state
  const initialState = pm.loadState();
  console.log('1. Initial state:', initialState ? 'Loaded' : 'Empty (as expected)');
  
  // Test 2: Save some data
  pm.scheduleAutoSave({
    workingDirectories: {
      'C123456-thread1': {
        channelId: 'C123456',
        threadTs: 'thread1',
        directory: '/test/path',
        setAt: new Date().toISOString()
      }
    }
  });
  
  console.log('2. Scheduled save for working directory');
  
  // Test 3: Force save and wait
  await pm.forceSave();
  console.log('3. Forced save completed');
  
  // Test 4: Reload and verify
  const newState = pm.loadState();
  console.log('4. Reloaded state:', {
    hasData: !!newState,
    workingDirs: newState ? Object.keys(newState.workingDirectories).length : 0,
    sessions: newState ? Object.keys(newState.sessions).length : 0
  });
  
  // Test 5: Check health
  console.log('5. Persistence health:', pm.isHealthy() ? '✅ Healthy' : '❌ Not healthy');
  
  // Test 6: Get stats
  const stats = pm.getStats();
  console.log('6. Stats:', stats);
  
  // Cleanup
  const fs = require('fs');
  try {
    fs.unlinkSync('./test-bot-state.json');
    fs.unlinkSync('./test-bot-state.json.backup');
  } catch (e) {
    // Ignore
  }
  
  console.log('\n✅ All persistence tests passed!');
}

test().catch(console.error);