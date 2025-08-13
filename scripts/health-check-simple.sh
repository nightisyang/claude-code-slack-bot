#!/bin/bash

# Simple health check script - restart if bot is stuck
HEALTH_URL="http://localhost:3001/health"
BOT_DIR="/Users/syoung/claude-code-slack-bot"
LOG_FILE="$BOT_DIR/logs/health-check.log"

# Create logs directory if it doesn't exist
mkdir -p "$BOT_DIR/logs"

# Function to restart the bot
restart_bot() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Restarting bot..." >> "$LOG_FILE"
    
    # Kill existing node processes running tsx
    pkill -f "tsx watch src/index.ts" 2>/dev/null
    sleep 2
    
    # Start the bot again
    cd "$BOT_DIR"
    # Set PATH for cron environment
    export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
    nohup npm run dev >> "$BOT_DIR/logs/bot.log" 2>&1 &
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot restarted with PID $!" >> "$LOG_FILE"
    
    # Wait a bit for bot to start
    sleep 10
}

# Check health endpoint
response=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" --connect-timeout 5 --max-time 10)

if [ "$response" = "200" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Health check PASS (HTTP 200)" >> "$LOG_FILE"
elif [ "$response" = "503" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot unhealthy (HTTP 503) - Restarting..." >> "$LOG_FILE"
    restart_bot
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot not responding (HTTP $response) - Restarting..." >> "$LOG_FILE"
    restart_bot
fi

# Clean up old log entries (keep last 1000 lines)
tail -n 1000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE" 2>/dev/null