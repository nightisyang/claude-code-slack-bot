import { Logger } from '../logger.js';
import { validateGitHubConfig, githubConfig } from './github-config.js';
import { GitHubWebhookServer } from './github-webhook-server.js';
import { GitHubWebhookHandler } from './github-webhook-handler.js';
import { GitHubApiClient } from './github-api-client.js';
import { ClaudeHandler } from '../claude-handler.js';

export class GitHubService {
  private logger = new Logger('GitHubService');
  private webhookServer: GitHubWebhookServer;
  private webhookHandler: GitHubWebhookHandler;
  private apiClient: GitHubApiClient;
  private claudeHandler: ClaudeHandler;
  private isRunning = false;

  constructor(claudeHandler: ClaudeHandler) {
    this.claudeHandler = claudeHandler;
    this.apiClient = new GitHubApiClient();
    this.webhookHandler = new GitHubWebhookHandler(this.apiClient, this.claudeHandler);
    this.webhookServer = new GitHubWebhookServer(this.webhookHandler);
  }

  /**
   * Start the GitHub service
   */
  async start(): Promise<void> {
    try {
      this.logger.info('Starting GitHub service...');

      // Validate configuration
      validateGitHubConfig();

      if (!githubConfig.enabled) {
        this.logger.info('GitHub integration is disabled');
        return;
      }

      // Test GitHub API connection
      this.logger.info('Testing GitHub API connection...');
      const connectionTest = await this.apiClient.testConnection();
      if (!connectionTest) {
        throw new Error('GitHub API connection test failed');
      }

      // Start webhook server
      await this.webhookServer.start();

      this.isRunning = true;
      this.logger.info('GitHub service started successfully', {
        webhookPort: githubConfig.webhookPort,
        webhookPath: githubConfig.webhookPath,
        reviewLevel: githubConfig.reviewLevel,
        enabledEvents: githubConfig.enabledEvents,
      });

    } catch (error) {
      this.logger.error('Failed to start GitHub service', error);
      throw error;
    }
  }

  /**
   * Stop the GitHub service
   */
  async stop(): Promise<void> {
    try {
      this.logger.info('Stopping GitHub service...');

      if (this.webhookServer) {
        await this.webhookServer.stop();
      }

      this.isRunning = false;
      this.logger.info('GitHub service stopped');

    } catch (error) {
      this.logger.error('Error stopping GitHub service', error);
      throw error;
    }
  }

  /**
   * Get service status
   */
  getStatus(): any {
    return {
      running: this.isRunning,
      enabled: githubConfig.enabled,
      webhookServerRunning: this.webhookServer?.isRunning() || false,
      config: {
        port: githubConfig.webhookPort,
        webhookPath: githubConfig.webhookPath,
        reviewLevel: githubConfig.reviewLevel,
        enabledEvents: githubConfig.enabledEvents,
        slackChannel: githubConfig.slackNotificationChannel,
      },
      processingStats: this.webhookHandler.getProcessingStats(),
    };
  }

  /**
   * Test GitHub API connection
   */
  async testConnection(): Promise<boolean> {
    return this.apiClient.testConnection();
  }
}