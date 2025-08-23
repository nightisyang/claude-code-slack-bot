# GitHub Integration Deployment Plan for Raspberry Pi

## Current Infrastructure Analysis

### Existing Services
1. **Systemd Services**
   - `cloudflared.service`: Cloudflare tunnel daemon
   - `nginx.service`: Reverse proxy server

2. **PM2 Processes**
   - `server` (ID: 0): Splish backend on port 8080
   - `nextjs` (ID: 1): Personal site on port 3002

3. **Nginx Configuration**
   - `chinup.rocks` → localhost:8080
   - `thisyoung.rocks` → localhost:3002
   - `chat.thisyoung.rocks` → localhost:12345

4. **Cloudflare Tunnel**
   - Tunnel ID: `193d9d8a-ad23-4bac-8142-e345279f983c`
   - Routes traffic to nginx on localhost:80

## Deployment Plan

### Phase 1: Prepare Environment

#### 1.1 Fix Port Conflicts
- **Issue**: GitHub webhook server configured for port 3002 (conflicts with NextJS)
- **Solution**: Change to port 3003 or another available port
- **Files to modify**: `.env` configuration

#### 1.2 Create GitHub App
- Navigate to GitHub Settings → Developer settings → GitHub Apps
- Configure webhook URL: `https://bot.thisyoung.rocks/github/webhooks`
- Set required permissions (Issues, PRs, Contents)
- Generate and save private key

#### 1.3 Environment Configuration
```env
# Add to .env file
GITHUB_INTEGRATION_ENABLED=true
GITHUB_APP_ID=<your-app-id>
GITHUB_PRIVATE_KEY_PATH=/etc/claude-bot/keys/github-app.pem
GITHUB_WEBHOOK_SECRET=<generated-secret>
GITHUB_INSTALLATION_ID=<installation-id>
GITHUB_WEBHOOK_PORT=3003  # Changed from 3002
GITHUB_NOTIFICATION_CHANNEL=#code-reviews
```

### Phase 2: Setup Bot as Systemd Service

#### 2.1 Create Systemd Service File
Create `/etc/systemd/system/claude-slack-bot.service`:
```ini
[Unit]
Description=Claude Code Slack Bot with GitHub Integration
After=network.target

[Service]
Type=simple
User=pihome
WorkingDirectory=/home/pihome/claude-code-slack-bot
Environment="NODE_ENV=production"
EnvironmentFile=/home/pihome/claude-code-slack-bot/.env
ExecStart=/usr/bin/npm run prod
Restart=always
RestartSec=10
StandardOutput=append:/var/log/claude-bot/bot.log
StandardError=append:/var/log/claude-bot/error.log

[Install]
WantedBy=multi-user.target
```

#### 2.2 Setup Logging
```bash
sudo mkdir -p /var/log/claude-bot
sudo chown pihome:pihome /var/log/claude-bot
```

### Phase 3: Configure Nginx & Cloudflare

#### 3.1 Create Nginx Site Configuration
Create `/etc/nginx/sites-available/bot.thisyoung.rocks`:
```nginx
server {
    listen 80;
    server_name bot.thisyoung.rocks;

    # Main bot health endpoint
    location /health {
        proxy_pass http://localhost:3001/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # GitHub webhook endpoint
    location /github {
        proxy_pass http://localhost:3003;
        proxy_http_version 1.1;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
        
        # GitHub webhooks can be large
        client_max_body_size 25M;
        proxy_read_timeout 90s;
    }

    # Slack bot endpoints (if needed)
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### 3.2 Enable Nginx Site
```bash
sudo ln -s /etc/nginx/sites-available/bot.thisyoung.rocks /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Phase 4: Cloudflare Configuration

#### 4.1 DNS Configuration (Cloudflare Dashboard)
1. **Add DNS Record**:
   - Type: `CNAME`
   - Name: `bot`
   - Target: `thisyoung.rocks` (or your tunnel subdomain)
   - Proxy status: Proxied (orange cloud)

2. **SSL/TLS Settings**:
   - Ensure SSL/TLS encryption mode is set to "Full" or "Full (strict)"
   - Enable "Always Use HTTPS"

#### 4.2 Update Cloudflare Tunnel Configuration
Edit `/etc/cloudflared/config.yml`:
```yaml
tunnel: 193d9d8a-ad23-4bac-8142-e345279f983c
credentials-file: /etc/cloudflared/193d9d8a-ad23-4bac-8142-e345279f983c.json

ingress:
  - hostname: bot.thisyoung.rocks
    service: http://localhost:80  # Nginx will handle routing
  - hostname: cari-tempat.thisyoung.rocks
    service: http://localhost:8888
  - hostname: thisyoung.rocks
    service: http://localhost:80
  - hostname: chinup.rocks
    service: http://localhost:80
  - service: http_status:404
```

#### 4.3 Restart Cloudflare Tunnel
```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared
```

#### 4.4 Cloudflare Security Settings (Optional but Recommended)
1. **Page Rules** (if available on your plan):
   - URL: `bot.thisyoung.rocks/github/*`
   - Settings: 
     - Security Level: High
     - Cache Level: Bypass

2. **Firewall Rules**:
   - Consider adding GitHub's webhook IP ranges to allowlist
   - GitHub webhook IPs: https://api.github.com/meta (check `hooks` array)

3. **Rate Limiting** (if concerned about abuse):
   - Path: `/github/webhooks`
   - Threshold: 100 requests per minute (adjust based on repo activity)

### Phase 5: Deploy & Test

#### 5.1 Deploy Bot Service
```bash
# Copy private key
sudo mkdir -p /etc/claude-bot/keys
sudo cp github-app-private-key.pem /etc/claude-bot/keys/
sudo chmod 600 /etc/claude-bot/keys/github-app-private-key.pem
sudo chown pihome:pihome /etc/claude-bot/keys/github-app-private-key.pem

# Build the bot
cd /home/pihome/claude-code-slack-bot
npm run build

# Start and enable service
sudo systemctl daemon-reload
sudo systemctl start claude-slack-bot
sudo systemctl enable claude-slack-bot
sudo systemctl status claude-slack-bot
```

#### 5.2 Verify Endpoints
```bash
# Test health endpoint locally
curl http://localhost:3001/health

# Test GitHub webhook endpoint locally
curl http://localhost:3003/health

# Test through Cloudflare
curl https://bot.thisyoung.rocks/health
```

#### 5.3 Test GitHub Integration
1. Create a test issue in connected repository
2. Check webhook delivery in GitHub App settings
3. Verify Slack notifications
4. Create a test PR to trigger review

### Phase 6: Monitoring & Maintenance

#### 6.1 Setup Log Rotation
Create `/etc/logrotate.d/claude-bot`:
```
/var/log/claude-bot/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 644 pihome pihome
    sharedscripts
    postrotate
        systemctl reload claude-slack-bot > /dev/null 2>&1 || true
    endscript
}
```

#### 6.2 Monitor Service
```bash
# View logs
sudo journalctl -u claude-slack-bot -f

# Check service status
systemctl status claude-slack-bot

# View custom logs
tail -f /var/log/claude-bot/bot.log
```

#### 6.3 Setup Monitoring Alerts (Optional)
- Use Cloudflare Analytics to monitor webhook traffic
- Set up Cloudflare Notifications for tunnel health
- Configure systemd to email on service failure

## Effort Summary

### GitHub Side (1-2 hours)
- Create and configure GitHub App
- Install on repositories
- Configure webhooks and permissions
- Generate and secure private key

### Server Side (2-3 hours)
- Configure environment variables
- Create systemd service
- Setup nginx reverse proxy
- Configure logging and monitoring
- Build and deploy bot

### Cloudflare Side (1 hour)
- Add DNS record for bot subdomain
- Update tunnel configuration
- Configure security settings (optional)
- Test webhook routing

### Testing & Validation (1-2 hours)
- Verify all endpoints
- Test GitHub webhook delivery
- Validate Slack notifications
- Monitor initial PR reviews

**Total Estimated Effort: 5-8 hours**

## Rollback Plan

If issues arise:
1. **Disable GitHub Integration**: Set `GITHUB_INTEGRATION_ENABLED=false`
2. **Stop Service**: `sudo systemctl stop claude-slack-bot`
3. **Remove from GitHub**: Uninstall app from repositories
4. **Revert Cloudflare**: Remove DNS record and tunnel config
5. **Clean up**: Remove systemd service and nginx config

## Security Considerations

1. **Private Key Security**
   - Store in `/etc/claude-bot/keys/` with 600 permissions
   - Regular rotation (annually)
   - Never commit to repository

2. **Webhook Validation**
   - Always verify webhook signatures
   - Use strong webhook secret
   - Implement rate limiting

3. **Network Security**
   - All traffic through Cloudflare (DDoS protection)
   - HTTPS only for webhooks
   - Internal services on localhost only

4. **Access Control**
   - Bot runs as non-root user (pihome)
   - Minimal file system permissions
   - Separate service isolation

## Next Steps

1. Review and approve this plan
2. Schedule maintenance window
3. Prepare GitHub App configuration
4. Backup current configuration
5. Execute deployment plan
6. Monitor for 24-48 hours post-deployment