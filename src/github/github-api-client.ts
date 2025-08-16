import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { Logger } from '../logger.js';
import { githubConfig, getGitHubPrivateKey } from './github-config.js';
import { GitHubInstallationToken, GitHubApiComment, GitHubApiReview } from './github-types.js';

export class GitHubApiClient {
  private logger = new Logger('GitHubApiClient');
  private installationToken: GitHubInstallationToken | null = null;
  private readonly baseUrl = 'https://api.github.com';

  constructor() {}

  /**
   * Generate JWT token for GitHub App authentication
   */
  private generateJWT(): string {
    const privateKey = getGitHubPrivateKey();
    const payload = {
      iat: Math.floor(Date.now() / 1000) - 60, // Issued 60 seconds ago
      exp: Math.floor(Date.now() / 1000) + 600, // Expires in 10 minutes
      iss: githubConfig.apiConfig.appId,
    };

    return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
  }

  /**
   * Get installation access token for API calls
   */
  private async getInstallationToken(): Promise<string> {
    // Return cached token if still valid
    if (this.installationToken && new Date(this.installationToken.expires_at) > new Date()) {
      return this.installationToken.token;
    }

    try {
      const jwtToken = this.generateJWT();
      
      const response = await fetch(
        `${this.baseUrl}/app/installations/${githubConfig.apiConfig.installationId}/access_tokens`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'claude-code-github-bot/1.0',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get installation token: ${response.status} ${response.statusText}`);
      }

      this.installationToken = await response.json() as GitHubInstallationToken;
      this.logger.info('Retrieved new installation token', {
        expiresAt: this.installationToken.expires_at,
      });

      return this.installationToken.token;
    } catch (error) {
      this.logger.error('Failed to get installation token', error);
      throw error;
    }
  }

  /**
   * Make authenticated API request to GitHub
   */
  private async makeApiRequest<T>(
    endpoint: string, 
    options: {
      method?: string;
      body?: any;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const token = await this.getInstallationToken();
    
    const { method = 'GET', body, headers = {} } = options;
    
    const requestHeaders = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'claude-code-github-bot/1.0',
      'Content-Type': 'application/json',
      ...headers,
    };

    const requestOptions: any = {
      method,
      headers: requestHeaders,
    };

    if (body) {
      requestOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, requestOptions);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json() as T;
    } catch (error) {
      this.logger.error('GitHub API request failed', {
        endpoint,
        method,
        error,
      });
      throw error;
    }
  }

  /**
   * Get pull request details
   */
  async getPullRequest(owner: string, repo: string, pullNumber: number): Promise<any> {
    this.logger.debug('Fetching pull request', { owner, repo, pullNumber });
    
    return this.makeApiRequest(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
  }

  /**
   * Get pull request diff
   */
  async getPullRequestDiff(owner: string, repo: string, pullNumber: number): Promise<string> {
    this.logger.debug('Fetching pull request diff', { owner, repo, pullNumber });
    
    const token = await this.getInstallationToken();
    
    const response = await fetch(
      `${this.baseUrl}/repos/${owner}/${repo}/pulls/${pullNumber}`,
      {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3.diff',
          'User-Agent': 'claude-code-github-bot/1.0',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get PR diff: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  }

  /**
   * Create a comment on a pull request
   */
  async createPullRequestComment(
    owner: string, 
    repo: string, 
    pullNumber: number, 
    body: string
  ): Promise<any> {
    this.logger.debug('Creating pull request comment', { owner, repo, pullNumber });
    
    return this.makeApiRequest(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
      method: 'POST',
      body: { body },
    });
  }

  /**
   * Create a review on a pull request
   */
  async createPullRequestReview(
    owner: string, 
    repo: string, 
    pullNumber: number, 
    review: GitHubApiReview
  ): Promise<any> {
    this.logger.debug('Creating pull request review', { owner, repo, pullNumber, event: review.event });
    
    return this.makeApiRequest(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
      method: 'POST',
      body: review,
    });
  }

  /**
   * Create a comment on an issue
   */
  async createIssueComment(
    owner: string, 
    repo: string, 
    issueNumber: number, 
    body: string
  ): Promise<any> {
    this.logger.debug('Creating issue comment', { owner, repo, issueNumber });
    
    return this.makeApiRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: { body },
    });
  }

  /**
   * Get repository information
   */
  async getRepository(owner: string, repo: string): Promise<any> {
    this.logger.debug('Fetching repository information', { owner, repo });
    
    return this.makeApiRequest(`/repos/${owner}/${repo}`);
  }

  /**
   * Get issue details
   */
  async getIssue(owner: string, repo: string, issueNumber: number): Promise<any> {
    this.logger.debug('Fetching issue details', { owner, repo, issueNumber });
    
    return this.makeApiRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`);
  }

  /**
   * Test API connection and permissions
   */
  async testConnection(): Promise<boolean> {
    try {
      // Test by getting installation info
      const token = await this.getInstallationToken();
      const jwtToken = this.generateJWT();
      
      const response = await fetch(`${this.baseUrl}/app/installations/${githubConfig.apiConfig.installationId}`, {
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'claude-code-github-bot/1.0',
        },
      });

      if (response.ok) {
        const installation = await response.json();
        this.logger.info('GitHub API connection successful', {
          installationId: installation.id,
          account: installation.account.login,
          appId: installation.app_id,
        });
        return true;
      } else {
        this.logger.error('GitHub API connection failed', {
          status: response.status,
          statusText: response.statusText,
        });
        return false;
      }
    } catch (error) {
      this.logger.error('GitHub API connection test failed', error);
      return false;
    }
  }
}