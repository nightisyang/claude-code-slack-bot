# Health Monitoring Setup Guide

## Available Health Endpoints

- **GET /health** - Basic health check (200 = healthy, 503 = unhealthy)
- **GET /status** - Detailed status with metrics

## Monitoring Options

### 1. Local Cron Job (Simple)
```bash
# Edit crontab
crontab -e

# Add health check every 5 minutes
*/5 * * * * /Users/syoung/claude-code-slack-bot/scripts/health-check.sh

# View cron logs
tail -f /var/log/claude-bot-health.log
```

### 2. PM2 Process Manager (Recommended)
```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.js

# Monitor
pm2 monit

# Setup startup script
pm2 startup
pm2 save

# View logs
pm2 logs claude-bot
```

### 3. UptimeRobot (Free External Monitoring)
1. Sign up at https://uptimerobot.com
2. Add HTTP(s) monitor
3. URL: `http://your-server:3001/health`
4. Check interval: 5 minutes
5. Alert contacts: Your email/Slack

### 4. Better Stack (Uptime.com)
```yaml
# .uptime.yml
checks:
  - name: Claude Bot Health
    url: https://your-domain.com:3001/health
    method: GET
    interval: 60
    locations:
      - us-east-1
      - eu-west-1
    assertions:
      - type: status_code
        comparison: equals
        target: 200
      - type: json_path
        path: $.status
        comparison: equals
        target: healthy
```

### 5. Datadog (Enterprise)
```javascript
// datadog-health-check.js
const { StatsD } = require('node-dogstatsd');
const axios = require('axios');

const dogstatsd = new StatsD();

setInterval(async () => {
  try {
    const { data } = await axios.get('http://localhost:3001/status');
    
    // Send metrics to Datadog
    dogstatsd.gauge('claude_bot.sessions.active', data.sessions.active);
    dogstatsd.gauge('claude_bot.memory.rss', parseInt(data.memory.rss));
    dogstatsd.gauge('claude_bot.uptime', data.uptime.seconds);
    
    if (data.slack.connected) {
      dogstatsd.increment('claude_bot.health.check.success');
    } else {
      dogstatsd.increment('claude_bot.health.check.failure');
    }
  } catch (error) {
    dogstatsd.increment('claude_bot.health.check.error');
  }
}, 60000); // Every minute
```

### 6. Self-Hosted Options

#### Uptime Kuma (Recommended for self-hosting)
```bash
# Docker setup
docker run -d --restart=always \
  -p 3002:3001 \
  -v uptime-kuma:/app/data \
  --name uptime-kuma \
  louislam/uptime-kuma:1

# Access at http://localhost:3002
# Add monitor for http://localhost:3001/health
```

#### Prometheus + Grafana
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'claude-bot'
    scrape_interval: 30s
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: '/metrics'  # Need to add this endpoint
```

## Alert Strategies

### Slack Webhook Alerts
```bash
export HEALTH_SLACK_WEBHOOK="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

### Email Alerts (using mail command)
```bash
# Add to health-check.sh
if [ "$http_code" != "200" ]; then
    echo "Claude Bot is down!" | mail -s "Bot Health Alert" your-email@example.com
fi
```

### PagerDuty Integration
```bash
# Send alert to PagerDuty
curl -X POST https://events.pagerduty.com/v2/enqueue \
  -H 'Content-Type: application/json' \
  -d '{
    "routing_key": "YOUR_ROUTING_KEY",
    "event_action": "trigger",
    "payload": {
      "summary": "Claude Bot health check failed",
      "severity": "error",
      "source": "claude-bot-monitor"
    }
  }'
```

## Recommended Setup

For production use, we recommend:

1. **PM2** for process management and auto-restart
2. **UptimeRobot** or **Better Stack** for external monitoring
3. **Cron job** as backup local monitoring
4. **Slack webhooks** for instant alerts

## Testing Health Checks

```bash
# Test health endpoint
curl http://localhost:3001/health

# Test status endpoint
curl http://localhost:3001/status | jq '.'

# Simulate failure (stop the bot)
pm2 stop claude-bot
# Check if monitoring detects it

# Simulate high memory
# The bot will auto-restart if memory > 500MB with PM2
```

## Monitoring Dashboard

Consider creating a simple dashboard:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Claude Bot Status</title>
    <script>
        async function checkHealth() {
            try {
                const response = await fetch('http://localhost:3001/status');
                const data = await response.json();
                document.getElementById('status').innerHTML = `
                    <h2>✅ Bot is ${data.slack.connected ? 'Connected' : '❌ Disconnected'}</h2>
                    <p>Active Sessions: ${data.sessions.active}</p>
                    <p>Memory: ${data.memory.rss}</p>
                    <p>Uptime: ${data.uptime.human}</p>
                `;
            } catch (error) {
                document.getElementById('status').innerHTML = '<h2>❌ Bot is Down</h2>';
            }
        }
        setInterval(checkHealth, 5000);
        checkHealth();
    </script>
</head>
<body>
    <h1>Claude Bot Health Dashboard</h1>
    <div id="status">Loading...</div>
</body>
</html>
```