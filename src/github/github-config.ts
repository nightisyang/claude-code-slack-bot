import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { GitHubServiceConfig, IssueResponseConfig } from './github-types.js';

dotenv.config();

export const githubConfig: GitHubServiceConfig = {
  enabled: process.env.GITHUB_INTEGRATION_ENABLED === 'true',
  webhookPort: parseInt(process.env.GITHUB_WEBHOOK_PORT || '3002'),
  webhookPath: process.env.GITHUB_WEBHOOK_PATH || '/github/webhooks',
  apiConfig: {
    appId: process.env.GITHUB_APP_ID || '',
    privateKeyPath: process.env.GITHUB_PRIVATE_KEY_PATH || '',
    installationId: process.env.GITHUB_INSTALLATION_ID || '',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
  },
  slackNotificationChannel: process.env.GITHUB_NOTIFICATION_CHANNEL || '#code-reviews',
  reviewLevel: (process.env.GITHUB_DEFAULT_REVIEW_LEVEL as 'basic' | 'comprehensive' | 'security-focused') || 'comprehensive',
  enabledEvents: [
    'pull_request',
    'pull_request_review', 
    'pull_request_review_comment',
    'issue_comment',
    'issues',
    'push'
  ],
  issueResponse: {
    enabled: process.env.GITHUB_ISSUE_RESPONSE_ENABLED !== 'false', // Default to true
    mode: (process.env.GITHUB_ISSUE_RESPONSE_MODE as 'automatic' | 'review' | 'hybrid') || 'automatic',
    maxResponseLength: parseInt(process.env.GITHUB_ISSUE_RESPONSE_MAX_LENGTH || '4000'),
    confidenceThreshold: parseFloat(process.env.GITHUB_ISSUE_RESPONSE_CONFIDENCE_THRESHOLD || '0.3'),
    rateLimitPerIssue: parseInt(process.env.GITHUB_ISSUE_RESPONSE_RATE_LIMIT || '5'),
    rateLimitWindow: parseInt(process.env.GITHUB_ISSUE_RESPONSE_RATE_WINDOW || '60'), // 60 minutes
    excludedLabels: (process.env.GITHUB_ISSUE_RESPONSE_EXCLUDED_LABELS || 'wontfix,duplicate,invalid').split(',').map(l => l.trim()),
    includedCommentTypes: (process.env.GITHUB_ISSUE_RESPONSE_INCLUDED_TYPES || 'question_technical,bug_report,feature_request,documentation,support,discussion').split(',').map(t => t.trim()),
    enableWelcomeMessages: process.env.GITHUB_ISSUE_RESPONSE_WELCOME_MESSAGES !== 'false', // Default to true
  },
};

export function validateGitHubConfig(): void {
  const required = [
    'GITHUB_APP_ID',
    'GITHUB_PRIVATE_KEY_PATH', 
    'GITHUB_INSTALLATION_ID',
    'GITHUB_WEBHOOK_SECRET',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required GitHub environment variables: ${missing.join(', ')}`);
  }

  // Validate private key file exists
  if (!fs.existsSync(githubConfig.apiConfig.privateKeyPath)) {
    throw new Error(`GitHub private key file not found: ${githubConfig.apiConfig.privateKeyPath}`);
  }

  // Validate webhook port
  if (isNaN(githubConfig.webhookPort) || githubConfig.webhookPort < 1000 || githubConfig.webhookPort > 65535) {
    throw new Error(`Invalid GitHub webhook port: ${githubConfig.webhookPort}`);
  }
}

export function getGitHubPrivateKey(): string {
  try {
    return fs.readFileSync(githubConfig.apiConfig.privateKeyPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read GitHub private key: ${error}`);
  }
}