import pkg from 'express';
const express = pkg;
import { Logger } from './logger.js';

export interface HealthServerStatus {
  slackConnected: boolean;
  activeSessions: number;
  memoryUsage: NodeJS.MemoryUsage;
  lastSuccessfulInteraction?: Date;
  mcpServersStatus: Record<string, boolean>;
  uptime: number;
  persistenceStats?: {
    workingDirs: number;
    sessions: number;
    fileExists: boolean;
    lastUpdated?: string;
  };
}

export class HealthServer {
  private app: any;
  private logger: Logger;
  private server: any;
  private port: number;
  private status: HealthServerStatus;

  constructor(port: number = 3000) {
    this.port = port;
    this.logger = new Logger('HealthServer');
    this.app = express();
    this.status = {
      slackConnected: false,
      activeSessions: 0,
      memoryUsage: process.memoryUsage(),
      mcpServersStatus: {},
      uptime: 0
    };

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Basic health check endpoint
    this.app.get('/health', (req, res) => {
      try {
        const isHealthy = this.status.slackConnected;
        
        res.status(isHealthy ? 200 : 503).json({
          status: isHealthy ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime()
        });
      } catch (error) {
        this.logger.error('Health check endpoint error', error);
        res.status(500).json({
          status: 'error',
          message: 'Health check failed',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Detailed status endpoint
    this.app.get('/status', (req, res) => {
      try {
        this.status.memoryUsage = process.memoryUsage();
        this.status.uptime = process.uptime();

        res.status(200).json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          slack: {
            connected: this.status.slackConnected,
            lastSuccessfulInteraction: this.status.lastSuccessfulInteraction
          },
          sessions: {
            active: this.status.activeSessions
          },
          memory: {
            rss: `${Math.round(this.status.memoryUsage.rss / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(this.status.memoryUsage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(this.status.memoryUsage.heapTotal / 1024 / 1024)}MB`,
            external: `${Math.round(this.status.memoryUsage.external / 1024 / 1024)}MB`
          },
          mcp: {
            servers: this.status.mcpServersStatus
          },
          persistence: this.status.persistenceStats || {
            workingDirs: 0,
            sessions: 0,
            fileExists: false
          },
          uptime: {
            seconds: Math.round(this.status.uptime),
            human: this.formatUptime(this.status.uptime)
          }
        });
      } catch (error) {
        this.logger.error('Status endpoint error', error);
        res.status(500).json({
          status: 'error',
          message: 'Status check failed',
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  private formatUptime(uptime: number): string {
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          this.logger.info(`Health server listening on port ${this.port}`);
          resolve();
        });

        this.server.on('error', (error: Error) => {
          this.logger.error('Health server error', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('Health server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Status update methods for external components to call
  public updateSlackConnectionStatus(connected: boolean): void {
    this.status.slackConnected = connected;
    if (connected) {
      this.status.lastSuccessfulInteraction = new Date();
    }
  }

  public updateActiveSessionsCount(count: number): void {
    this.status.activeSessions = count;
  }

  public updateMcpServerStatus(serverName: string, status: boolean): void {
    this.status.mcpServersStatus[serverName] = status;
  }

  public recordSuccessfulInteraction(): void {
    this.status.lastSuccessfulInteraction = new Date();
  }

  public updatePersistenceStats(stats: { workingDirs: number; sessions: number; fileExists: boolean; lastUpdated?: string }): void {
    this.status.persistenceStats = stats;
  }
}