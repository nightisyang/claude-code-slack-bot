# 🔧 Claude Code Slack Bot - Emergency Recovery Guide

## Safe State Information

### Last Known Good Commit
- **Commit Hash**: `f5b6f6d`
- **Message**: "Add isolated persistence layer with comprehensive testing"
- **Branch**: `feature/persistence-layer`
- **Date**: Latest stable commit as of recovery doc creation

### Quick Recovery Commands
```bash
# Emergency reset to last known good state
git checkout f5b6f6d
npm install
npm run dev

# Or reset to main branch
git checkout main
npm install 
npm run dev

# Check if bot is running
curl -s http://localhost:3000/health || echo "Bot not responding"
```

## Current Configuration Status

### Environment Requirements
```bash
# Required variables (check with: env | grep -E "(SLACK|ANTHROPIC|CLAUDE)")
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...  
SLACK_SIGNING_SECRET=...
ANTHROPIC_API_KEY=...

# Optional
BASE_DIRECTORY=/Users/syoung/Code/
DEBUG=true
CLAUDE_CODE_USE_BEDROCK=1
CLAUDE_CODE_USE_VERTEX=1
```

### File Structure Check
```bash
# Verify critical files exist
ls -la src/index.ts src/slack-handler.ts src/claude-handler.ts
ls -la package.json .env mcp-servers.json
```

## Error Recovery Procedures

### 1. Slack Connection Issues
**Symptoms**: Bot not responding to mentions/DMs
```bash
# Check tokens
node -e "console.log(process.env.SLACK_BOT_TOKEN?.substring(0,10))"
node -e "console.log(process.env.SLACK_APP_TOKEN?.substring(0,10))"

# Restart with fresh connection
pkill -f "tsx.*index.ts"
npm run dev
```

### 2. Claude SDK Errors  
**Symptoms**: "Failed to start the bot", API errors
```bash
# Check API key
node -e "console.log(process.env.ANTHROPIC_API_KEY?.substring(0,10))"

# Clear any corrupt sessions (if implemented)
rm -rf /tmp/claude-sessions-*

# Restart
npm run dev
```

### 3. Permission/File Access Issues
**Symptoms**: Cannot write files, permission denied
```bash
# Check working directory permissions
ls -la "${BASE_DIRECTORY:-$HOME/Code}"

# Check temp directory
ls -la /tmp/claude-slack-*

# Fix permissions if needed
chmod 755 "${BASE_DIRECTORY:-$HOME/Code}"
```

### 4. MCP Server Issues
**Symptoms**: Tools not working, MCP errors
```bash
# Check MCP config
cat mcp-servers.json

# Test MCP servers manually (if configured)
# Reset to minimal config
echo '{"mcpServers":{}}' > mcp-servers.json
npm run dev
```

### 5. Memory/Resource Issues
**Symptoms**: Bot becoming unresponsive, high memory usage
```bash
# Check process memory
ps aux | grep tsx

# Kill and restart
pkill -f "tsx.*index.ts"
npm run dev

# Monitor resources
watch "ps aux | grep tsx"
```

## Development Safety Procedures

### Before Making Changes
```bash
# 1. Commit current working state
git add -A
git commit -m "WIP: Safe checkpoint before updates"

# 2. Note current commit for easy rollback
git rev-parse HEAD > .last-safe-commit

# 3. Ensure bot is working
curl -s http://localhost:3000/health && echo "✅ Bot healthy"
```

### During Development
```bash
# Run with auto-restart and error catching
npm run dev 2>&1 | tee development.log

# Monitor in separate terminal
tail -f development.log | grep -E "(ERROR|WARN|failed)"
```

### After Changes
```bash
# Test basic functionality
# 1. Send a DM to bot
# 2. Mention in channel  
# 3. Upload a file
# 4. Check reactions appear
```

## Health Check Implementation
The bot should have these endpoints for monitoring:

- **GET /health** - Basic health check
- **GET /status** - Detailed status including:
  - Slack connection status
  - Active sessions count
  - Memory usage
  - Last successful interaction

## Work Log Template

### Development Session Log
```
Date: YYYY-MM-DD HH:MM
Starting commit: [git rev-parse HEAD]
Goal: [Brief description]

Changes made:
- [ ] File 1: Description
- [ ] File 2: Description

Tests performed:
- [ ] DM functionality
- [ ] Channel mentions
- [ ] File uploads
- [ ] Error handling

Issues encountered:
- Issue 1: Description -> Resolution
- Issue 2: Description -> Still investigating

Ending status: ✅ Working | ⚠️ Partial | ❌ Broken
Final commit: [git rev-parse HEAD]
```

## Automatic Recovery Features
The following should be implemented for production:

1. **Process Monitoring**: Use PM2 or similar for auto-restart
2. **Health Endpoints**: HTTP endpoints for external monitoring  
3. **Graceful Degradation**: Fallback modes when components fail
4. **Session Persistence**: Save sessions to disk for crash recovery
5. **Circuit Breakers**: Stop retrying failed external APIs
6. **Dead Letter Queue**: Store failed messages for retry

## Emergency Contacts / Resources

- **Anthropic API Status**: https://status.anthropic.com/
- **Slack API Status**: https://status.slack.com/
- **Claude Code SDK Docs**: [Latest documentation]
- **Local Logs**: `development.log`, console output
- **Configuration**: `.env`, `mcp-servers.json`

---

**Last Updated**: Auto-generated on recovery system creation
**Next Review**: Update after major changes or incidents