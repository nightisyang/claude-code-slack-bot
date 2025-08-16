import { Logger } from '../logger.js';
import { githubConfig } from './github-config.js';
import { GitHubApiClient } from './github-api-client.js';
import { GitHubRepositoryManager, RepositoryInfo } from './github-repository-manager.js';
import { GitHubSlackNotifier } from './github-slack-notifier.js';
import { ClaudeHandler } from '../claude-handler.js';
import {
  GitHubWebhookPayload,
  GitHubWebhookHeaders,
  PullRequestPayload,
  PullRequestReviewPayload,
  IssueCommentPayload,
  WebhookEvent,
  WebhookProcessingResult,
} from './github-types.js';

export class GitHubWebhookHandler {
  private logger = new Logger('GitHubWebhookHandler');
  private apiClient: GitHubApiClient;
  private repositoryManager: GitHubRepositoryManager;
  private slackNotifier: GitHubSlackNotifier;
  private claudeHandler: ClaudeHandler;

  constructor(apiClient: GitHubApiClient, claudeHandler: ClaudeHandler) {
    this.apiClient = apiClient;
    this.claudeHandler = claudeHandler;
    this.repositoryManager = new GitHubRepositoryManager();
    this.slackNotifier = new GitHubSlackNotifier();
  }

  /**
   * Process incoming webhook event
   */
  async processWebhook(
    eventType: string,
    payload: GitHubWebhookPayload,
    headers: GitHubWebhookHeaders
  ): Promise<WebhookProcessingResult> {
    const event: WebhookEvent = {
      id: headers['x-github-delivery'],
      type: eventType,
      payload,
      timestamp: new Date(),
      repository: payload.repository?.full_name || 'unknown',
    };

    this.logger.info('Processing webhook event', {
      eventId: event.id,
      eventType,
      action: payload.action,
      repository: event.repository,
      sender: payload.sender?.login,
    });

    try {
      let result: WebhookProcessingResult;

      switch (eventType) {
        case 'pull_request':
          result = await this.handlePullRequest(event, payload as PullRequestPayload);
          break;
        
        case 'pull_request_review':
          result = await this.handlePullRequestReview(event, payload as PullRequestReviewPayload);
          break;
        
        case 'pull_request_review_comment':
          result = await this.handlePullRequestReviewComment(event, payload);
          break;
        
        case 'issue_comment':
          result = await this.handleIssueComment(event, payload as IssueCommentPayload);
          break;
        
        case 'issues':
          result = await this.handleIssue(event, payload);
          break;
        
        case 'push':
          result = await this.handlePush(event, payload);
          break;
        
        default:
          this.logger.debug('Unhandled event type', { eventType });
          result = {
            success: true,
            event,
            actions_taken: [`Logged ${eventType} event`],
          };
      }

      this.logger.info('Webhook processing completed', {
        eventId: event.id,
        success: result.success,
        actionsTaken: result.actions_taken?.length || 0,
        notificationSent: result.notification_sent,
      });

      return result;
    } catch (error) {
      this.logger.error('Webhook processing failed', {
        eventId: event.id,
        eventType,
        error,
      });

      return {
        success: false,
        event,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Handle pull request events
   */
  private async handlePullRequest(
    event: WebhookEvent,
    payload: PullRequestPayload
  ): Promise<WebhookProcessingResult> {
    const { action, pull_request: pr } = payload;
    const actions: string[] = [];

    this.logger.info('Handling pull request event', {
      action,
      prNumber: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      merged: pr.merged,
    });

    switch (action) {
      case 'opened':
        actions.push(`Logged PR #${pr.number} opened`);
        if (!pr.draft) {
          actions.push('PR is ready for review');
          // Trigger automated review for non-draft PRs
          try {
            const reviewResult = await this.analyzePullRequest(payload);
            if (reviewResult.success) {
              actions.push('Automated review completed and posted');
            } else {
              actions.push(`Automated review failed: ${reviewResult.error}`);
            }
          } catch (error) {
            this.logger.error('Failed to analyze PR', { prNumber: pr.number, error });
            actions.push('Automated review failed due to error');
          }
        }
        break;
      
      case 'synchronize':
        actions.push(`Logged PR #${pr.number} updated with new commits`);
        // Re-run automated review on new changes
        try {
          const reviewResult = await this.analyzePullRequest(payload);
          if (reviewResult.success) {
            actions.push('Automated re-review completed and posted');
          } else {
            actions.push(`Automated re-review failed: ${reviewResult.error}`);
          }
        } catch (error) {
          this.logger.error('Failed to re-analyze PR', { prNumber: pr.number, error });
          actions.push('Automated re-review failed due to error');
        }
        break;
      
      case 'closed':
        if (pr.merged) {
          actions.push(`Logged PR #${pr.number} merged`);
        } else {
          actions.push(`Logged PR #${pr.number} closed without merging`);
        }
        break;
      
      case 'reopened':
        actions.push(`Logged PR #${pr.number} reopened`);
        break;
      
      default:
        actions.push(`Logged PR #${pr.number} ${action}`);
    }

    return {
      success: true,
      event,
      actions_taken: actions,
    };
  }

  /**
   * Handle pull request review events
   */
  private async handlePullRequestReview(
    event: WebhookEvent,
    payload: PullRequestReviewPayload
  ): Promise<WebhookProcessingResult> {
    const { action, review, pull_request: pr } = payload;
    const actions: string[] = [];

    this.logger.info('Handling pull request review event', {
      action,
      prNumber: pr.number,
      reviewState: review.state,
      reviewer: review.user.login,
    });

    switch (action) {
      case 'submitted':
        actions.push(`Logged review ${review.state} by ${review.user.login} on PR #${pr.number}`);
        break;
      
      case 'edited':
        actions.push(`Logged review edit by ${review.user.login} on PR #${pr.number}`);
        break;
      
      case 'dismissed':
        actions.push(`Logged review dismissal on PR #${pr.number}`);
        break;
      
      default:
        actions.push(`Logged review ${action} on PR #${pr.number}`);
    }

    return {
      success: true,
      event,
      actions_taken: actions,
    };
  }

  /**
   * Handle pull request review comment events
   */
  private async handlePullRequestReviewComment(
    event: WebhookEvent,
    payload: any
  ): Promise<WebhookProcessingResult> {
    const { action, comment, pull_request: pr } = payload;
    const actions: string[] = [];

    this.logger.info('Handling PR review comment event', {
      action,
      prNumber: pr.number,
      commenter: comment.user.login,
    });

    actions.push(`Logged review comment ${action} by ${comment.user.login} on PR #${pr.number}`);

    return {
      success: true,
      event,
      actions_taken: actions,
    };
  }

  /**
   * Handle issue comment events
   */
  private async handleIssueComment(
    event: WebhookEvent,
    payload: IssueCommentPayload
  ): Promise<WebhookProcessingResult> {
    const { action, comment, issue } = payload;
    const actions: string[] = [];

    this.logger.info('Handling issue comment event', {
      action,
      issueNumber: issue.number,
      commenter: comment.user.login,
      isPullRequest: !!issue.pull_request,
    });

    if (issue.pull_request) {
      actions.push(`Logged PR comment ${action} by ${comment.user.login} on PR #${issue.number}`);
    } else {
      actions.push(`Logged issue comment ${action} by ${comment.user.login} on issue #${issue.number}`);
    }

    return {
      success: true,
      event,
      actions_taken: actions,
    };
  }

  /**
   * Handle issue events
   */
  private async handleIssue(
    event: WebhookEvent,
    payload: any
  ): Promise<WebhookProcessingResult> {
    const { action, issue } = payload;
    const actions: string[] = [];

    this.logger.info('Handling issue event', {
      action,
      issueNumber: issue.number,
      title: issue.title,
      state: issue.state,
    });

    actions.push(`Logged issue #${issue.number} ${action}`);

    return {
      success: true,
      event,
      actions_taken: actions,
    };
  }

  /**
   * Handle push events
   */
  private async handlePush(
    event: WebhookEvent,
    payload: any
  ): Promise<WebhookProcessingResult> {
    const { ref, commits, repository } = payload;
    const actions: string[] = [];

    this.logger.info('Handling push event', {
      ref,
      commitCount: commits?.length || 0,
      repository: repository.full_name,
    });

    actions.push(`Logged push to ${ref} with ${commits?.length || 0} commits`);

    return {
      success: true,
      event,
      actions_taken: actions,
    };
  }

  /**
   * Analyze pull request using Claude Code AI
   */
  private async analyzePullRequest(payload: PullRequestPayload): Promise<{ success: boolean; error?: string }> {
    const { pull_request: pr, repository } = payload;
    const [owner, repo] = repository.full_name.split('/');
    
    this.logger.info('Starting PR analysis', {
      repository: repository.full_name,
      prNumber: pr.number,
      title: pr.title,
    });

    let repoInfo: RepositoryInfo | null = null;

    try {
      // Get installation token for repository access
      const installationToken = await this.apiClient['getInstallationToken']();
      
      // Ensure repository is cloned locally
      repoInfo = await this.repositoryManager.ensureRepository(owner, repo, installationToken);
      
      // Checkout the PR branch
      await this.repositoryManager.checkoutPullRequest(repoInfo, pr.number);
      
      // Get changed files and diff
      const changedFiles = await this.repositoryManager.getPullRequestFiles(repoInfo, pr.base.ref);
      const diff = await this.repositoryManager.getPullRequestDiff(repoInfo, pr.base.ref);
      
      // Prepare context for Claude analysis
      const analysisPrompt = this.buildAnalysisPrompt(pr, changedFiles.all, diff);
      
      // Create a session for GitHub PR analysis
      const sessionKey = `github-pr-${repository.full_name.replace('/', '-')}-${pr.number}`;
      const session = this.claudeHandler.createSession('github-bot', 'github-analysis', sessionKey);
      
      // Set working directory to the repository
      session.workingDirectory = repoInfo.localPath;
      
      // Send analysis request to Claude
      let reviewResult = '';
      for await (const message of this.claudeHandler.streamQuery(
        analysisPrompt,
        session,
        undefined,
        repoInfo.localPath
      )) {
        if (message.content && typeof message.content === 'string') {
          reviewResult += message.content;
        }
      }
      
      // Extract review content from Claude's response
      const reviewContent = this.extractReviewContent(reviewResult);
      
      // Post review as GitHub comment
      await this.apiClient.createPullRequestComment(
        owner,
        repo,
        pr.number,
        reviewContent
      );
      
      // Send Slack notification
      await this.slackNotifier.notifyPRReviewCompleted(
        repository.full_name,
        pr.number,
        pr.title,
        pr.user.login,
        pr.html_url
      );
      
      this.logger.info('PR analysis completed successfully', {
        repository: repository.full_name,
        prNumber: pr.number,
        filesAnalyzed: changedFiles.all.length,
      });
      
      return { success: true };
      
    } catch (error) {
      this.logger.error('PR analysis failed', {
        repository: repository.full_name,
        prNumber: pr.number,
        error,
      });
      
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      // Clean up repository after analysis
      if (repoInfo) {
        await this.repositoryManager.cleanup(repoInfo);
      }
    }
  }

  /**
   * Build analysis prompt for Claude
   */
  private buildAnalysisPrompt(pr: any, changedFiles: string[], diff: string): string {
    const reviewLevel = githubConfig.reviewLevel || 'comprehensive';
    
    return `Please perform a ${reviewLevel} code review for this pull request.

**Pull Request Information:**
- Title: ${pr.title}
- Description: ${pr.body || 'No description provided'}
- Author: ${pr.user.login}
- Files Changed: ${changedFiles.length}

**Changed Files:**
${changedFiles.map(file => `- ${file}`).join('\n')}

**Diff Content:**
\`\`\`diff
${diff}
\`\`\`

**Review Instructions:**
1. Analyze the code changes for:
   - Code quality and best practices
   - Potential bugs or issues
   - Security vulnerabilities
   - Performance considerations
   - Documentation needs

2. Provide:
   - Overall assessment (APPROVE, REQUEST_CHANGES, or COMMENT)
   - Specific line-by-line feedback when needed
   - Suggestions for improvement
   - Security concerns if any

3. Format your response as a GitHub review comment with:
   - Summary of changes
   - Key findings
   - Recommendations
   - Overall verdict

Please be constructive and helpful in your feedback.`;
  }

  /**
   * Extract review content from Claude's response
   */
  private extractReviewContent(claudeResponse: string): string {
    // Format the response as a proper GitHub review comment
    return `## 🤖 Automated Code Review\n\n${claudeResponse}\n\n---\n*Review generated by Claude Code AI*`;
  }


  /**
   * Get processing statistics
   */
  getProcessingStats(): any {
    // Future: Implement processing statistics tracking
    return {
      eventsProcessed: 0,
      successRate: 100,
      averageProcessingTime: 0,
    };
  }
}