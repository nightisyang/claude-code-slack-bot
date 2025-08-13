#!/bin/bash

# Shutdown script for Claude Code Slack Bot
# This script:
# 1. Stops the bot gracefully
# 2. Optionally removes the cron job
# 3. Cleans up PID files

BOT_DIR="/Users/syoung/claude-code-slack-bot"
PID_FILE="$BOT_DIR/.bot.pid"
LOG_FILE="$BOT_DIR/logs/shutdown.log"
CRON_IDENTIFIER="# CLAUDE_BOT_HEALTH_CHECK"

# Parse arguments
REMOVE_CRON=false
if [ "$1" = "--remove-cron" ]; then
    REMOVE_CRON=true
fi

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
    echo "$1"
}

# Stop the bot
stop_bot() {
    log_message "Stopping Claude Code Slack Bot..."
    
    # Kill by PID file if it exists
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            kill "$pid"
            log_message "Stopped bot process (PID: $pid)"
        fi
        rm "$PID_FILE"
    fi
    
    # Kill any remaining tsx watch processes
    if pgrep -f "tsx watch src/index.ts" > /dev/null; then
        pkill -f "tsx watch src/index.ts"
        log_message "Stopped tsx watch processes"
    fi
}

# Remove cron job
remove_cron_job() {
    log_message "Removing cron job..."
    
    # Get current crontab
    current_crontab=$(crontab -l 2>/dev/null || echo "")
    
    if echo "$current_crontab" | grep -q "$CRON_IDENTIFIER"; then
        # Remove our health check line
        new_crontab=$(echo "$current_crontab" | grep -v "$CRON_IDENTIFIER")
        
        if [ -z "$new_crontab" ]; then
            # No other cron jobs left, remove crontab entirely
            crontab -r 2>/dev/null
            log_message "Removed cron job (crontab now empty)"
        else
            # Update crontab with remaining jobs
            echo "$new_crontab" | crontab -
            log_message "Removed cron job"
        fi
    else
        log_message "No cron job found to remove"
    fi
}

# Main execution
main() {
    log_message "=== Shutting down Claude Code Slack Bot ==="
    
    stop_bot
    
    if [ "$REMOVE_CRON" = true ]; then
        remove_cron_job
    else
        log_message "Keeping cron job (bot will auto-restart in max 5 minutes)"
        log_message "To remove cron job, run: $0 --remove-cron"
    fi
    
    log_message "=== Shutdown complete ==="
    echo "✅ Bot stopped successfully"
}

main