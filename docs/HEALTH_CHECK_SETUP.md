# Health Check & Auto-Restart Setup

## Overview
This health check system monitors the Claude Code Slack Bot and automatically restarts it if it becomes unresponsive or unhealthy.

## How It Works
1. **Health Endpoint**: The bot exposes a `/health` endpoint on port 3001
   - Returns HTTP 200 with `{"status": "healthy"}` when working
   - Returns HTTP 503 when unhealthy
   - No response indicates the bot is stuck/crashed

2. **Health Check Script**: Runs every 5 minutes via cron
   - Checks the health endpoint
   - Restarts the bot if not healthy or not responding
   - Logs all actions to `logs/health-check.log`

## Setup Instructions

### 1. Test the Health Check Script
```bash
# Run manually to test
/Users/syoung/claude-code-slack-bot/scripts/health-check-simple.sh

# Check the log
tail -f /Users/syoung/claude-code-slack-bot/logs/health-check.log
```

### 2. Install Cron Job
```bash
# Add to your crontab
crontab -e

# Add these lines:
# Claude Code Slack Bot Health Check
*/5 * * * * /Users/syoung/claude-code-slack-bot/scripts/health-check-simple.sh

# Or use the provided file:
crontab /Users/syoung/claude-code-slack-bot/scripts/crontab-entry.txt
```

### 3. Verify Cron Job
```bash
# List current crontab
crontab -l

# Check cron is running
sudo launchctl list | grep com.vix.cron

# Monitor health check logs
tail -f /Users/syoung/claude-code-slack-bot/logs/health-check.log
```

## Manual Commands

### Check Bot Health
```bash
curl http://localhost:3001/health
```

### Get Detailed Status
```bash
curl http://localhost:3001/status | jq '.'
```

### Manually Restart Bot
```bash
npm run restart
# or
/Users/syoung/claude-code-slack-bot/scripts/health-check-simple.sh
```

### Stop Bot
```bash
npm run stop
```

## Log Files
- **Health Check Log**: `logs/health-check.log` - Health check results and restart actions
- **Bot Log**: `logs/bot.log` - Bot output when started by health check
- **Original Console**: When running `npm run dev` manually, output goes to console

## Troubleshooting

### Cron Not Running on macOS
```bash
# Enable cron on macOS
sudo launchctl load -w /System/Library/LaunchDaemons/com.vix.cron.plist
```

### Permission Issues
```bash
# Make sure script is executable
chmod +x /Users/syoung/claude-code-slack-bot/scripts/health-check-simple.sh

# Check file permissions
ls -la /Users/syoung/claude-code-slack-bot/scripts/
```

### Bot Keeps Restarting
Check the health check log to see why:
```bash
tail -n 50 /Users/syoung/claude-code-slack-bot/logs/health-check.log
```

Common causes:
- Port 3001 already in use by another process
- Environment variables not set (.env file missing)
- Slack/Anthropic API issues

### Multiple Bot Instances
If multiple instances are running:
```bash
# Kill all bot instances
pkill -f "tsx watch src/index.ts"

# Start fresh
npm run dev
```

## Monitoring

### View Recent Health Checks
```bash
grep "Health check" /Users/syoung/claude-code-slack-bot/logs/health-check.log | tail -20
```

### Count Restarts Today
```bash
grep "$(date '+%Y-%m-%d')" /Users/syoung/claude-code-slack-bot/logs/health-check.log | grep -c "Restarting"
```

### Watch Live Status
```bash
watch -n 5 'curl -s http://localhost:3001/status | jq .'
```

## Expected Behavior

- **Normal Operation**: Health check passes every 5 minutes, logged as "PASS"
- **Bot Crash**: Health check gets no response, automatically restarts bot
- **Bot Unhealthy**: Health check gets 503 response, automatically restarts bot
- **After Restart**: Bot should be healthy within 10-30 seconds

## Disable Health Checks
To temporarily disable:
```bash
# Comment out the cron job
crontab -e
# Add # at the beginning of the health check line

# Or remove completely
crontab -r
```