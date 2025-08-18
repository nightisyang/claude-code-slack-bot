# GitHub Integration Deployment Guide

This guide provides step-by-step instructions to deploy the GitHub integration for automated PR reviews and issue comment responses in your repository.

## Overview

The GitHub integration provides:
- **Automated PR Reviews**: AI-powered code review with Claude AI
- **Automated Issue Responses**: Intelligent responses to issue comments  
- **Slack Notifications**: Real-time notifications for all GitHub activities
- **Repository Context**: Full codebase awareness for accurate responses

## Prerequisites

### 1. Existing Infrastructure
- ✅ Claude Code Slack Bot deployed and running
- ✅ Claude AI authentication configured (`claude setup-token`)
- ✅ Slack workspace with bot permissions
- ✅ Server with public internet access for webhook delivery

### 2. Domain Requirements
- **Public domain** or **ngrok tunnel** for webhook URL
- **HTTPS endpoint** (GitHub requires HTTPS for webhook delivery)
- **Port access** for webhook server (default: 3002)

### 3. GitHub Repository Access
- **Admin access** to target repositories
- **Organization permissions** to create GitHub Apps (if applicable)

## Part 1: GitHub App Setup

### Step 1: Create GitHub App

1. Navigate to **GitHub Settings** → **Developer settings** → **GitHub Apps**
2. Click **"New GitHub App"**
3. Configure the app with these settings:

#### Basic Information
```
App name: claude-code-reviewer
Description: AI-powered code review and issue response automation  
Homepage URL: https://your-domain.com (or your organization URL)
Webhook URL: https://your-domain.com/github/webhooks
Webhook secret: [Generate a secure random string - save this!]
```

#### Permissions
**Repository Permissions (Read & Write)**:
- ✅ Issues
- ✅ Pull requests  
- ✅ Contents
- ✅ Metadata

**Repository Permissions (Read Only)**:
- ✅ Actions (optional - for CI/CD integration)
- ✅ Checks (optional - for status updates)

**Organization Permissions (Read Only)**:
- ✅ Members (optional - for reviewer assignment)

#### Webhook Events
Subscribe to these events:
- ✅ `pull_request` (opened, synchronize, closed)
- ✅ `pull_request_review` (submitted, edited, dismissed) 
- ✅ `pull_request_review_comment` (created, edited)
- ✅ `issue_comment` (created, edited)
- ✅ `issues` (opened, edited, closed)
- ✅ `push` (optional - for branch updates)

### Step 2: Install GitHub App

1. **Install the app** on your organization or specific repositories
2. **Grant access** to target repositories
3. **Note the Installation ID** from the installation URL
4. **Generate and download** the private key (.pem file)

### Step 3: Collect Required Information

After creating the app, collect these values:
```
GitHub App ID: [from app settings page]
Installation ID: [from installation URL]
Private Key: [downloaded .pem file] 
Webhook Secret: [the secret you generated]
```

## Part 2: Server Configuration

### Step 1: Environment Variables

Add these environment variables to your server:

#### Required Variables
```env
# GitHub Integration Control
GITHUB_INTEGRATION_ENABLED=true

# GitHub App Configuration  
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY_PATH=/path/to/private-key.pem
GITHUB_WEBHOOK_SECRET=your-webhook-secret-here
GITHUB_INSTALLATION_ID=78910

# GitHub Webhook Server
GITHUB_WEBHOOK_PORT=3002
GITHUB_WEBHOOK_URL=https://your-domain.com/github/webhooks

# Slack Integration
GITHUB_NOTIFICATION_CHANNEL=#code-reviews
```

#### Optional Configuration Variables
```env
# PR Review Settings
GITHUB_DEFAULT_REVIEW_LEVEL=comprehensive
# Options: basic, comprehensive, security-focused

# Issue Response Settings (all default to enabled/automatic)
GITHUB_ISSUE_RESPONSE_ENABLED=true
GITHUB_ISSUE_RESPONSE_MODE=automatic
# Options: automatic, review, hybrid

GITHUB_ISSUE_RESPONSE_MAX_LENGTH=4000
GITHUB_ISSUE_RESPONSE_CONFIDENCE_THRESHOLD=0.3
GITHUB_ISSUE_RESPONSE_RATE_LIMIT=5
GITHUB_ISSUE_RESPONSE_RATE_WINDOW=60

# Content Filtering
GITHUB_ISSUE_RESPONSE_EXCLUDED_LABELS=wontfix,duplicate,invalid
GITHUB_ISSUE_RESPONSE_INCLUDED_TYPES=question_technical,bug_report,feature_request,documentation,support,discussion
GITHUB_ISSUE_RESPONSE_WELCOME_MESSAGES=true
```

### Step 2: Private Key Setup

1. **Upload the private key** to your server:
   ```bash
   # Create secure directory
   sudo mkdir -p /etc/claude-bot/keys
   sudo chmod 700 /etc/claude-bot/keys
   
   # Upload private key
   sudo cp github-app-private-key.pem /etc/claude-bot/keys/
   sudo chmod 600 /etc/claude-bot/keys/github-app-private-key.pem
   sudo chown claude-bot:claude-bot /etc/claude-bot/keys/github-app-private-key.pem
   ```

2. **Update environment variable**:
   ```env
   GITHUB_PRIVATE_KEY_PATH=/etc/claude-bot/keys/github-app-private-key.pem
   ```

### Step 3: Webhook URL Configuration

#### Option A: Public Domain (Recommended)
If you have a public domain:
```env
GITHUB_WEBHOOK_URL=https://your-domain.com/github/webhooks
```

#### Option B: ngrok (Development/Testing)
If using ngrok for testing:
```bash
# Install ngrok
npm install -g ngrok

# Start tunnel
ngrok http 3002

# Use the HTTPS URL provided
GITHUB_WEBHOOK_URL=https://abc123.ngrok.io/github/webhooks
```

### Step 4: Firewall and Network

Ensure your server can:
- **Receive HTTPS traffic** on webhook port (3002)
- **Make outbound HTTPS requests** to GitHub API
- **Access Claude AI services** (existing requirement)

## Part 3: Deployment and Testing

### Step 1: Deploy Updated Bot

1. **Pull latest code** with GitHub integration
2. **Update environment variables** with GitHub configuration
3. **Restart the bot** to load new configuration:
   ```bash
   npm run restart
   ```

### Step 2: Verify Health Status

Check that GitHub integration is running:
```bash
# Check main bot health
curl http://localhost:3001/health

# Check GitHub webhook server health  
curl http://localhost:3002/health

# Check status
npm run status
```

Expected response should include GitHub webhook server status.

### Step 3: Test Webhook Delivery

1. **Create a test issue** in a connected repository
2. **Add a comment** to the issue
3. **Check logs** for webhook processing:
   ```bash
   tail -f logs/bot.log | grep -i github
   ```

### Step 4: Test Automated Features

#### Test PR Review Automation
1. **Create a pull request** in connected repository
2. **Verify automated review** appears on GitHub within 2-5 minutes
3. **Check Slack notification** in configured channel

#### Test Issue Response Automation  
1. **Create an issue** with a technical question
2. **Add a comment** asking for help or clarification
3. **Verify automated response** appears on GitHub within 1-2 minutes
4. **Check Slack notification** with confidence score

### Step 5: Monitor Performance

Monitor the integration using:
```bash
# View GitHub integration logs
tail -f logs/bot.log | grep GitHub

# Check webhook server metrics
curl http://localhost:3002/status

# Monitor GitHub API rate limits
# (Check logs for rate limit warnings)
```

## Part 4: Configuration Options

### PR Review Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_DEFAULT_REVIEW_LEVEL` | `comprehensive` | Review depth: `basic`, `comprehensive`, `security-focused` |

### Issue Response Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_ISSUE_RESPONSE_ENABLED` | `true` | Enable/disable issue responses |
| `GITHUB_ISSUE_RESPONSE_MODE` | `automatic` | Response mode: `automatic`, `review`, `hybrid` |
| `GITHUB_ISSUE_RESPONSE_MAX_LENGTH` | `4000` | Maximum response length in characters |
| `GITHUB_ISSUE_RESPONSE_CONFIDENCE_THRESHOLD` | `0.3` | Minimum confidence to post response |
| `GITHUB_ISSUE_RESPONSE_RATE_LIMIT` | `5` | Max responses per issue in time window |
| `GITHUB_ISSUE_RESPONSE_RATE_WINDOW` | `60` | Rate limit window in minutes |
| `GITHUB_ISSUE_RESPONSE_EXCLUDED_LABELS` | `wontfix,duplicate,invalid` | Issue labels to skip |
| `GITHUB_ISSUE_RESPONSE_WELCOME_MESSAGES` | `true` | Enable welcome messages for new contributors |

### Response Mode Options

- **`automatic`**: Post responses immediately without human approval
- **`review`**: Send to Slack for human approval before posting  
- **`hybrid`**: Auto-post simple responses, review complex ones

## Part 5: Troubleshooting

### Common Issues

#### Webhook Not Receiving Events
```bash
# Check webhook URL accessibility
curl -X POST https://your-domain.com/github/webhooks

# Verify GitHub app webhook configuration
# Check webhook delivery logs in GitHub app settings
```

#### Authentication Errors
```bash
# Verify private key file exists and is readable
ls -la /etc/claude-bot/keys/

# Test GitHub API connection
# Check logs for JWT/token errors
```

#### Missing Responses
```bash
# Check if integration is enabled
grep GITHUB_INTEGRATION_ENABLED .env

# Verify webhook events are configured
# Check GitHub app webhook event subscriptions
```

### Log Analysis

Key log patterns to monitor:
```bash
# Successful webhook processing
grep "Webhook processing completed" logs/bot.log

# Automated response posting
grep "Automated response posted" logs/bot.log

# Error patterns
grep -i "error.*github" logs/bot.log
```

### GitHub API Rate Limits

The integration respects GitHub API rate limits:
- **5000 requests/hour** for authenticated requests
- **Automatic retry** with exponential backoff
- **Rate limit monitoring** in logs

## Part 6: Security Considerations

### Webhook Security
- ✅ **HTTPS required** for webhook endpoint
- ✅ **Signature verification** for all webhook payloads
- ✅ **Secret validation** prevents unauthorized requests

### Private Key Security
- ✅ **Secure file permissions** (600) on private key
- ✅ **Restricted directory access** (/etc/claude-bot/keys/)
- ✅ **Regular key rotation** recommended (annually)

### Response Safety
- ✅ **Content validation** prevents harmful responses
- ✅ **Safety rules** block potentially dangerous content
- ✅ **Human oversight** via Slack notifications

## Part 7: Monitoring and Maintenance

### Health Monitoring

Set up monitoring for:
- **Webhook server uptime** (`http://localhost:3002/health`)
- **GitHub API connectivity** (check logs for API errors)
- **Response quality** (monitor Slack notifications)

### Regular Maintenance

**Weekly Tasks**:
- Review Slack notifications for response quality
- Check GitHub webhook delivery logs
- Monitor API rate limit usage

**Monthly Tasks**:
- Review and update excluded labels if needed
- Assess response confidence thresholds
- Update private key if approaching expiration

**As Needed**:
- Adjust configuration based on team feedback
- Update repository access for new projects
- Scale webhook server if processing high volume

## Success Metrics

Monitor these metrics to assess integration success:

### Technical Metrics
- **Webhook delivery success rate** > 99%
- **PR review response time** < 5 minutes
- **Issue response time** < 2 minutes
- **API error rate** < 1%

### Quality Metrics  
- **Response relevance** (team feedback)
- **False positive rate** (inappropriate responses)
- **User engagement** with automated responses
- **Time saved** on manual reviews

## Support and Feedback

### Getting Help
- **Check logs** first for error details
- **Review configuration** for missing variables
- **Test webhook delivery** using GitHub interface
- **Verify GitHub app permissions** are correctly set

### Providing Feedback
- **Slack notifications** show response previews for quality assessment
- **GitHub issues** can be used to report integration problems
- **Response confidence scores** help identify areas for improvement

---

**🎉 Congratulations!** Your GitHub integration is now ready to provide automated PR reviews and issue responses. The system will help your team by providing instant, intelligent responses to GitHub activities while maintaining transparency through Slack notifications.