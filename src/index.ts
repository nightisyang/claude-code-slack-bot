import pkg from '@slack/bolt';
const { App } = pkg;
import { config, validateConfig } from './config.js';
import { ClaudeHandler } from './claude-handler.js';
import { SlackHandler } from './slack-handler.js';
import { McpManager } from './mcp-manager.js';
import { Logger } from './logger.js';
import { PersistenceManager } from './persistence-manager.js';
import { HealthServer } from './health-server.js';

const logger = new Logger('Main');

async function start() {
  try {
    // Validate configuration
    validateConfig();

    logger.info('Starting Claude Code Slack bot', {
      debug: config.debug,
      useBedrock: config.claude.useBedrock,
      useVertex: config.claude.useVertex,
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

    // Setup event handlers
    slackHandler.setupEventHandlers();

    // Start health server first
    healthServer.start();
    healthServer.updateSlackConnectionStatus(false);

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
      healthEndpoint: 'http://localhost:3001/health'
    });
  } catch (error) {
    logger.error('Failed to start the bot', error);
    process.exit(1);
  }
}

start();
