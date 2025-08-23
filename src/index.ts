import pkg from '@slack/bolt';
const { App } = pkg;
import { config, validateConfig } from './config.js';
import { ClaudeHandler } from './claude-handler.js';
import { SlackHandler } from './slack-handler.js';
import { McpManager } from './mcp-manager.js';
import { Logger } from './logger.js';
import { PersistenceManager } from './persistence-manager.js';
import { HealthServer } from './health-server.js';
import { githubConfig, validateGitHubConfig } from './github/github-config.js';
import { GitHubWebhookServer } from './github/github-webhook-server.js';
import { GitHubWebhookHandler } from './github/github-webhook-handler.js';
import { GitHubApiClient } from './github/github-api-client.js';

const logger = new Logger('Main');

async function start() {
  try {
    // Validate configuration
    validateConfig();

    // Validate GitHub configuration if enabled
    if (githubConfig.enabled) {
      try {
        validateGitHubConfig();
        logger.info('GitHub integration enabled', {
          webhookPort: githubConfig.webhookPort,
          reviewLevel: githubConfig.reviewLevel,
          enabledEvents: githubConfig.enabledEvents,
        });
      } catch (error) {
        logger.error('GitHub configuration validation failed', error);
        logger.warn('GitHub integration will be disabled');
        githubConfig.enabled = false;
      }
    } else {
      logger.info('GitHub integration disabled');
    }

    logger.info('Starting Claude Code Slack bot', {
      debug: config.debug,
      useBedrock: config.claude.useBedrock,
      useVertex: config.claude.useVertex,
      githubEnabled: githubConfig.enabled,
    });

    // Initialize Slack app
    const app = new App({
      token: config.slack.botToken,
      signingSecret: config.slack.signingSecret,
      socketMode: true,
      appToken: config.slack.appToken,
    });

    // Initialize persistence and health monitoring
    const persistenceManager = new PersistenceManager();
    const healthServer = new HealthServer(3001);

    // Initialize MCP manager
    const mcpManager = new McpManager();
    const mcpConfig = mcpManager.loadConfiguration();

    // Initialize handlers
    const claudeHandler = new ClaudeHandler(mcpManager, persistenceManager);
    const slackHandler = new SlackHandler(app, claudeHandler, mcpManager, persistenceManager, healthServer);

    // Initialize GitHub webhook server if enabled
    if (githubConfig.enabled) {
      try {
        const githubApiClient = new GitHubApiClient();
        const githubWebhookHandler = new GitHubWebhookHandler(githubApiClient, claudeHandler);
        githubWebhookServerInstance = new GitHubWebhookServer(githubWebhookHandler);
      } catch (error) {
        logger.error('Failed to initialize GitHub webhook server', error);
        githubConfig.enabled = false;
      }
    }

    // Setup event handlers
    slackHandler.setupEventHandlers();

    // Start health server first
    healthServer.start();
    healthServer.updateSlackConnectionStatus(false);

    // Start GitHub webhook server if enabled
    if (githubWebhookServerInstance) {
      try {
        await githubWebhookServerInstance.start();
        logger.info('GitHub webhook server started successfully');
      } catch (error) {
        logger.error('Failed to start GitHub webhook server', error);
        githubConfig.enabled = false;
      }
    }

    // Start the Slack app
    await app.start();
    healthServer.updateSlackConnectionStatus(true);

    logger.info('⚡️ Claude Code Slack bot is running!');
    logger.info('Configuration:', {
      usingCommunityProvider: true,
      debugMode: config.debug,
      baseDirectory: config.baseDirectory || 'not set',
      mcpServers: mcpConfig ? Object.keys(mcpConfig.mcpServers).length : 0,
      mcpServerNames: mcpConfig ? Object.keys(mcpConfig.mcpServers) : [],
      healthEndpoint: 'http://localhost:3001/health',
      githubWebhookEnabled: githubConfig.enabled,
      githubWebhookEndpoint: githubConfig.enabled ? `http://localhost:${githubConfig.webhookPort}/health` : 'disabled'
    });
  } catch (error) {
    logger.error('Failed to start the bot', error);
    process.exit(1);
  }
}

// Global references for cleanup
let githubWebhookServerInstance: GitHubWebhookServer | null = null;

// Graceful shutdown handler
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  
  if (githubWebhookServerInstance) {
    try {
      await githubWebhookServerInstance.stop();
      logger.info('GitHub webhook server stopped');
    } catch (error) {
      logger.error('Error stopping GitHub webhook server', error);
    }
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  
  if (githubWebhookServerInstance) {
    try {
      await githubWebhookServerInstance.stop();
      logger.info('GitHub webhook server stopped');
    } catch (error) {
      logger.error('Error stopping GitHub webhook server', error);
    }
  }
  
  process.exit(0);
});

start();
