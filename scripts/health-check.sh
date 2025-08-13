#!/bin/bash

# Health check script for Claude Code Slack Bot
HEALTH_URL="http://localhost:3001/health"
STATUS_URL="http://localhost:3001/status"
LOG_FILE="/var/log/claude-bot-health.log"
SLACK_WEBHOOK_URL="${HEALTH_SLACK_WEBHOOK:-}" # Optional: Set in environment

# Function to send Slack alert
send_slack_alert() {
    local message="$1"
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🚨 Claude Bot Alert: $message\"}" \
            "$SLACK_WEBHOOK_URL" 2>/dev/null
    fi
}

# Check health endpoint
response=$(curl -s -w "\n%{http_code}" "$HEALTH_URL" 2>/dev/null)
http_code=$(echo "$response" | tail -1)
body=$(echo "$response" | head -n -1)

timestamp=$(date '+%Y-%m-%d %H:%M:%S')

if [ "$http_code" = "200" ]; then
    echo "[$timestamp] Health check PASS" >> "$LOG_FILE"
    
    # Check if status is actually healthy
    status=$(echo "$body" | jq -r '.status' 2>/dev/null)
    if [ "$status" != "healthy" ]; then
        echo "[$timestamp] WARNING: Bot reporting unhealthy status" >> "$LOG_FILE"
        send_slack_alert "Bot is running but reporting unhealthy status"
        
        # Try to restart the bot
        cd /Users/syoung/claude-code-slack-bot
        npm run restart 2>&1 >> "$LOG_FILE"
    fi
else
    echo "[$timestamp] Health check FAIL (HTTP $http_code)" >> "$LOG_FILE"
    send_slack_alert "Bot health check failed (HTTP $http_code)"
    
    # Attempt restart
    echo "[$timestamp] Attempting restart..." >> "$LOG_FILE"
    cd /Users/syoung/claude-code-slack-bot
    npm run restart 2>&1 >> "$LOG_FILE"
fi

# Optional: Check detailed status for warnings
if [ "$http_code" = "200" ]; then
    status_response=$(curl -s "$STATUS_URL" 2>/dev/null)
    active_sessions=$(echo "$status_response" | jq -r '.sessions.active' 2>/dev/null)
    memory_rss=$(echo "$status_response" | jq -r '.memory.rss' 2>/dev/null | sed 's/MB//')
    
    # Alert if too many active sessions (possible memory leak)
    if [ "$active_sessions" -gt "20" ]; then
        echo "[$timestamp] WARNING: High active sessions: $active_sessions" >> "$LOG_FILE"
        send_slack_alert "High active session count: $active_sessions"
    fi
    
    # Alert if memory usage is too high
    if [ "$memory_rss" -gt "500" ]; then
        echo "[$timestamp] WARNING: High memory usage: ${memory_rss}MB" >> "$LOG_FILE"
        send_slack_alert "High memory usage: ${memory_rss}MB"
    fi
fi