// GitHub webhook event types and API response types

export interface GitHubWebhookHeaders {
  'x-github-event': string;
  'x-github-delivery': string;
  'x-hub-signature-256': string;
  'user-agent': string;
}

// Base webhook payload structure
export interface GitHubWebhookPayload {
  action?: string;
  number?: number;
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      id: number;
    };
    default_branch: string;
    clone_url: string;
    ssh_url: string;
  };
  sender: {
    login: string;
    id: number;
    avatar_url: string;
  };
}

// Pull Request specific types
export interface PullRequestPayload extends GitHubWebhookPayload {
  action: 'opened' | 'closed' | 'synchronize' | 'reopened' | 'edited' | 'assigned' | 'unassigned' | 'review_requested' | 'review_request_removed' | 'labeled' | 'unlabeled';
  pull_request: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    merged: boolean;
    draft: boolean;
    head: {
      ref: string;
      sha: string;
      repo: {
        full_name: string;
        clone_url: string;
      };
    };
    base: {
      ref: string;
      sha: string;
      repo: {
        full_name: string;
        clone_url: string;
      };
    };
    user: {
      login: string;
      id: number;
    };
    assignees: Array<{
      login: string;
      id: number;
    }>;
    requested_reviewers: Array<{
      login: string;
      id: number;
    }>;
    labels: Array<{
      name: string;
      color: string;
    }>;
    diff_url: string;
    patch_url: string;
    html_url: string;
  };
}

// Pull Request Review types
export interface PullRequestReviewPayload extends GitHubWebhookPayload {
  action: 'submitted' | 'edited' | 'dismissed';
  review: {
    id: number;
    body: string | null;
    state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
    html_url: string;
    user: {
      login: string;
      id: number;
    };
  };
  pull_request: PullRequestPayload['pull_request'];
}

// Issue Comment types
export interface IssueCommentPayload extends GitHubWebhookPayload {
  action: 'created' | 'edited' | 'deleted';
  issue: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    user: {
      login: string;
      id: number;
    };
    labels: Array<{
      name: string;
      color: string;
    }>;
    html_url: string;
    pull_request?: {
      url: string;
      html_url: string;
      diff_url: string;
      patch_url: string;
    };
  };
  comment: {
    id: number;
    body: string;
    user: {
      login: string;
      id: number;
    };
    html_url: string;
    created_at: string;
    updated_at: string;
  };
}

// GitHub API client types
export interface GitHubApiConfig {
  appId: string;
  privateKeyPath: string;
  installationId: string;
  webhookSecret: string;
}

export interface GitHubInstallationToken {
  token: string;
  expires_at: string;
}

export interface GitHubApiComment {
  body: string;
  path?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
}

export interface GitHubApiReview {
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments?: GitHubApiComment[];
}

// Webhook processing types
export interface WebhookEvent {
  id: string;
  type: string;
  payload: GitHubWebhookPayload;
  timestamp: Date;
  repository: string;
}

export interface WebhookProcessingResult {
  success: boolean;
  event: WebhookEvent;
  error?: string;
  actions_taken?: string[];
  notification_sent?: boolean;
}

// Configuration types
export interface GitHubServiceConfig {
  enabled: boolean;
  webhookPort: number;
  webhookPath: string;
  apiConfig: GitHubApiConfig;
  slackNotificationChannel?: string;
  reviewLevel: 'basic' | 'comprehensive' | 'security-focused';
  enabledEvents: string[];
}