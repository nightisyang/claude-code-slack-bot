import express from 'express';
import * as crypto from 'crypto';
import { Logger } from '../logger.js';
import { githubConfig } from './github-config.js';
import { GitHubWebhookHeaders, GitHubWebhookPayload } from './github-types.js';
import { GitHubWebhookHandler } from './github-webhook-handler.js';

export class GitHubWebhookServer {
  private app: express.Application;
  private server: any;
  private logger = new Logger('GitHubWebhookServer');
  private webhookHandler: GitHubWebhookHandler;

  constructor(webhookHandler: GitHubWebhookHandler) {
    this.app = express();
    this.webhookHandler = webhookHandler;
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Parse raw body for webhook signature verification
    this.app.use(express.raw({ type: 'application/json', limit: '10mb' }));
    
    // Basic logging middleware
    this.app.use((req, res, next) => {
      this.logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        userAgent: req.get('user-agent'),
        contentLength: req.get('content-length'),
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Main webhook endpoint
    this.app.post(githubConfig.webhookPath, async (req, res) => {
      try {
        await this.handleWebhook(req, res);
      } catch (error) {
        this.logger.error('Webhook processing failed', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Health check endpoint for GitHub webhook service
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'github-webhook-server',
        timestamp: new Date().toISOString(),
        port: githubConfig.webhookPort,
        webhookPath: githubConfig.webhookPath,
        enabledEvents: githubConfig.enabledEvents,
      });
    });

    // Status endpoint with more details
    this.app.get('/status', (req, res) => {
      res.json({
        status: 'running',
        service: 'github-webhook-server',
        version: '1.0.0',
        config: {
          port: githubConfig.webhookPort,
          webhookPath: githubConfig.webhookPath,
          reviewLevel: githubConfig.reviewLevel,
          enabledEvents: githubConfig.enabledEvents,
          slackChannel: githubConfig.slackNotificationChannel,
        },
        timestamp: new Date().toISOString(),
      });
    });

    // Catch-all for undefined routes
    this.app.all('*', (req, res) => {
      this.logger.warn('Request to unknown endpoint', {
        method: req.method,
        path: req.path,
      });
      res.status(404).json({ error: 'Endpoint not found' });
    });
  }

  private async handleWebhook(req: express.Request, res: express.Response): Promise<void> {
    const signature = req.get('x-hub-signature-256');
    const githubEvent = req.get('x-github-event');
    const deliveryId = req.get('x-github-delivery');

    // Validate required headers
    if (!signature || !githubEvent || !deliveryId) {
      this.logger.warn('Missing required webhook headers', {
        hasSignature: !!signature,
        hasEvent: !!githubEvent,
        hasDelivery: !!deliveryId,
      });
      res.status(400).json({ error: 'Missing required headers' });
      return;
    }

    // Verify webhook signature
    if (!this.verifyWebhookSignature(req.body, signature)) {
      this.logger.error('Invalid webhook signature', { deliveryId, event: githubEvent });
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Check if event type is enabled
    if (!githubConfig.enabledEvents.includes(githubEvent)) {
      this.logger.debug('Event type not enabled, ignoring', { 
        event: githubEvent, 
        deliveryId,
        enabledEvents: githubConfig.enabledEvents 
      });
      res.status(200).json({ message: 'Event type not enabled' });
      return;
    }

    try {
      // Parse payload
      const payload: GitHubWebhookPayload = JSON.parse(req.body.toString());
      
      this.logger.info('Processing webhook event', {
        event: githubEvent,
        deliveryId,
        action: payload.action,
        repository: payload.repository?.full_name,
        sender: payload.sender?.login,
      });

      // Process webhook asynchronously
      const headers: GitHubWebhookHeaders = {
        'x-github-event': githubEvent,
        'x-github-delivery': deliveryId,
        'x-hub-signature-256': signature,
        'user-agent': req.get('user-agent') || '',
      };

      // Hand off to webhook handler (don't await to respond quickly)
      this.webhookHandler.processWebhook(githubEvent, payload, headers)
        .catch(error => {
          this.logger.error('Async webhook processing failed', {
            error,
            event: githubEvent,
            deliveryId,
          });
        });

      // Respond quickly to GitHub
      res.status(200).json({ 
        message: 'Webhook received',
        event: githubEvent,
        deliveryId,
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      this.logger.error('Failed to parse webhook payload', {
        error,
        deliveryId,
        event: githubEvent,
      });
      res.status(400).json({ error: 'Invalid JSON payload' });
    }
  }

  private verifyWebhookSignature(payload: Buffer, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', githubConfig.apiConfig.webhookSecret)
      .update(payload)
      .digest('hex');

    const expectedSignatureWithPrefix = `sha256=${expectedSignature}`;
    
    // Use timingSafeEqual to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSignatureWithPrefix, 'utf8')
      );
    } catch (error) {
      this.logger.error('Signature verification error', error);
      return false;
    }
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(githubConfig.webhookPort, () => {
          this.logger.info('GitHub webhook server started', {
            port: githubConfig.webhookPort,
            webhookPath: githubConfig.webhookPath,
            healthEndpoint: `http://localhost:${githubConfig.webhookPort}/health`,
          });
          resolve();
        });

        this.server.on('error', (error: any) => {
          this.logger.error('Server error', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('GitHub webhook server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public isRunning(): boolean {
    return !!this.server && this.server.listening;
  }
}