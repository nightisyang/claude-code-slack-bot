#!/bin/bash

# Startup script for Claude Code Slack Bot
# This script:
# 1. Ensures health check cron job is installed (without duplicates)
# 2. Starts the bot
# 3. Ensures only one instance is running

BOT_DIR="/Users/syoung/claude-code-slack-bot"
HEALTH_CHECK_SCRIPT="$BOT_DIR/scripts/health-check-simple.sh"
LOG_FILE="$BOT_DIR/logs/startup.log"
PID_FILE="$BOT_DIR/.bot.pid"
CRON_IDENTIFIER="# CLAUDE_BOT_HEALTH_CHECK"

# Create logs directory if it doesn't exist
mkdir -p "$BOT_DIR/logs"

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
    echo "$1"
}

# Function to setup cron job without duplicates
setup_cron_job() {
    log_message "Setting up cron job..."
    
    # Create the cron entry we want
    CRON_ENTRY="*/5 * * * * $HEALTH_CHECK_SCRIPT $CRON_IDENTIFIER"
    
    # Get current crontab (ignore error if no crontab exists)
    current_crontab=$(crontab -l 2>/dev/null || echo "")
    
    # Check if our health check is already in crontab
    if echo "$current_crontab" | grep -q "$CRON_IDENTIFIER"; then
        log_message "Cron job already exists, skipping..."
    else
        # Add our cron job to the existing crontab
        if [ -z "$current_crontab" ]; then
            # No existing crontab
            echo "$CRON_ENTRY" | crontab -
        else
            # Append to existing crontab
            (echo "$current_crontab"; echo "$CRON_ENTRY") | crontab -
        fi
        log_message "Cron job installed successfully"
    fi
}

# Function to check if bot is already running
is_bot_running() {
    if [ -f "$PID_FILE" ]; then
        old_pid=$(cat "$PID_FILE")
        if ps -p "$old_pid" > /dev/null 2>&1; then
            return 0  # Bot is running
        else
            # PID file exists but process is dead
            rm "$PID_FILE"
        fi
    fi
    
    # Also check for any tsx watch processes
    if pgrep -f "tsx watch src/index.ts" > /dev/null; then
        return 0  # Bot is running
    fi
    
    return 1  # Bot is not running
}

# Function to stop existing bot instances
stop_existing_bot() {
    log_message "Stopping any existing bot instances..."
    
    # Kill by PID file if it exists
    if [ -f "$PID_FILE" ]; then
        old_pid=$(cat "$PID_FILE")
        kill "$old_pid" 2>/dev/null || true
        rm "$PID_FILE"
    fi
    
    # Kill any tsx watch processes
    pkill -f "tsx watch src/index.ts" 2>/dev/null || true
    
    sleep 2
}

# Function to start the bot
start_bot() {
    log_message "Starting Claude Code Slack Bot..."
    
    cd "$BOT_DIR"
    
    # Load environment variables
    if [ -f "$BOT_DIR/.env" ]; then
        export $(cat "$BOT_DIR/.env" | grep -v '^#' | xargs)
    fi
    
    # Start the bot in background and save PID
    nohup npm run dev >> "$BOT_DIR/logs/bot.log" 2>&1 &
    bot_pid=$!
    
    # Save PID to file
    echo "$bot_pid" > "$PID_FILE"
    
    log_message "Bot started with PID $bot_pid"
    
    # Wait a bit and check if it's still running
    sleep 5
    if ps -p "$bot_pid" > /dev/null; then
        log_message "Bot is running successfully"
        
        # Check health endpoint
        sleep 5
        if curl -s -f "http://localhost:3001/health" > /dev/null 2>&1; then
            log_message "Health endpoint is responding"
        else
            log_message "Warning: Health endpoint not yet responding"
        fi
    else
        log_message "Error: Bot process died after starting"
        rm "$PID_FILE"
        exit 1
    fi
}

# Main execution
main() {
    log_message "=== Starting Claude Code Slack Bot Setup ==="
    
    # Setup cron job (idempotent - won't create duplicates)
    setup_cron_job
    
    # Check if bot is already running
    if is_bot_running; then
        log_message "Bot is already running"
        
        # Verify health endpoint
        if curl -s -f "http://localhost:3001/health" > /dev/null 2>&1; then
            log_message "Health endpoint is responding - bot is healthy"
            echo "✅ Bot is already running and healthy"
        else
            log_message "Bot process exists but health endpoint not responding - restarting..."
            stop_existing_bot
            start_bot
        fi
    else
        log_message "Bot is not running - starting it now..."
        start_bot
    fi
    
    log_message "=== Setup Complete ==="
    echo ""
    echo "✅ Claude Code Slack Bot is running!"
    echo "📋 Logs: $BOT_DIR/logs/"
    echo "🔍 Health check: curl http://localhost:3001/health"
    echo "📊 Status: curl http://localhost:3001/status"
    echo "🛑 Stop: npm run stop"
}

# Run main function
main