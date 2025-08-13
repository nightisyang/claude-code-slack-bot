# Startup Behavior & Cron Management

## How Different Start Commands Work

### `npm run start` (Production Mode - WITH Auto-Recovery)
```bash
npm run start
# or
npm restart
```
- ✅ **Installs cron job** (if not already installed)
- ✅ **Starts the bot** using `npm run dev` internally
- ✅ **Auto-recovery enabled** - Bot will auto-restart within 5 minutes if it crashes
- ✅ **Prevents duplicate cron jobs** - Safe to run multiple times
- ✅ **Checks health** before starting

**Use this for:** Production deployments, servers, when you want automatic recovery

### `npm run dev` (Development Mode - NO Auto-Recovery)
```bash
npm run dev
```
- ❌ **Does NOT install cron job**
- ❌ **No auto-recovery** - If bot crashes, it stays down
- ✅ **Hot reload** with tsx watch
- ✅ **Console output** visible for debugging

**Use this for:** Active development, debugging, when you want to see crashes

### `npm run start:direct` (Direct Start - NO Auto-Recovery)
```bash
npm run start:direct
```
- ❌ **Does NOT install cron job**
- ❌ **No auto-recovery**
- ❌ **No hot reload**
- ✅ **Direct execution** of TypeScript

**Use this for:** Testing, one-off runs

## Cron Job Behavior

### When Cron Job is Active
The cron job runs every 5 minutes and:
1. Checks if bot process exists
2. Pings health endpoint
3. If unhealthy or not responding → Restarts the bot

### Important: Development vs Production

| Scenario | Cron Installed? | Auto-Recovery? | Safe for Dev? |
|----------|----------------|----------------|---------------|
| `npm run start` | Yes | Yes | ⚠️ Use carefully |
| `npm run dev` | No | No | ✅ Perfect for dev |
| Manual start | No | No | ✅ Fine |
| After server reboot | If installed | Yes | ✅ Automatic |

## Server Restart Behavior

### With Cron Job Installed (via `npm run start`)
- **After system reboot:** Bot auto-starts within 5 minutes
- **After crash:** Bot auto-restarts within 5 minutes
- **After manual stop:** Bot auto-restarts within 5 minutes (unless cron removed)

### Without Cron Job (via `npm run dev`)
- **After system reboot:** Bot does NOT start
- **After crash:** Bot stays down
- **After manual stop:** Bot stays down

## Best Practices

### For Development
```bash
# Use dev mode - no auto-recovery
npm run dev

# If you accidentally installed cron, remove it
npm run stop:all  # Removes cron job
```

### For Production
```bash
# Use managed start - includes auto-recovery
npm run start

# Check status
npm run status

# Stop temporarily (will auto-restart in 5 min)
npm run stop

# Stop permanently (removes cron)
npm run stop:all
```

### Switching Between Modes

#### From Dev to Production
```bash
# Stop dev mode (Ctrl+C or kill process)
pkill -f "tsx watch"

# Start with auto-recovery
npm run start
```

#### From Production to Dev
```bash
# Stop and remove cron
npm run stop:all

# Start in dev mode
npm run dev
```

## Common Scenarios

### "I want to develop but bot keeps restarting"
You have cron job installed. Remove it:
```bash
npm run stop:all
npm run dev
```

### "I deployed to server but bot doesn't restart after crash"
You started with `npm run dev` instead of `npm run start`:
```bash
npm run start  # This installs cron and enables auto-recovery
```

### "Multiple bot instances running"
```bash
# Kill all instances
pkill -f "tsx watch src/index.ts"

# Start fresh with management
npm run start
```

### "Want to temporarily disable auto-restart"
```bash
# Disable cron temporarily
crontab -e
# Comment out the line with # CLAUDE_BOT_HEALTH_CHECK

# Or remove it completely
npm run stop:all
```

## File Locations

- **PID File:** `.bot.pid` - Tracks managed bot process
- **Cron Identifier:** `# CLAUDE_BOT_HEALTH_CHECK` - Used to prevent duplicates
- **Logs:**
  - `logs/startup.log` - Startup script actions
  - `logs/shutdown.log` - Shutdown script actions  
  - `logs/health-check.log` - Health check results
  - `logs/bot.log` - Bot output (when started via script)

## Quick Reference

```bash
# Production with auto-recovery
npm run start

# Development without auto-recovery  
npm run dev

# Check if cron is installed
crontab -l | grep CLAUDE_BOT

# Remove all automation
npm run stop:all

# Check bot status
npm run status
```