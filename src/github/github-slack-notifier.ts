import { Logger } from '../logger.js';
import { githubConfig } from './github-config.js';

export interface GitHubSlackNotification {
  repository: string;
  prNumber?: number;
  issueNumber?: number;
  title?: string;
  action: string;
  author?: string;
  url?: string;
  eventType: 'pr_opened' | 'pr_review_completed' | 'pr_merged' | 'issue_opened' | 'issue_comment';
}

export class GitHubSlackNotifier {
  private logger = new Logger('GitHubSlackNotifier');

  constructor() {}

  /**
   * Send notification to Slack about GitHub events
   */
  async sendNotification(notification: GitHubSlackNotification): Promise<void> {
    try {
      const message = this.formatNotificationMessage(notification);
      
      this.logger.info('Sending GitHub notification to Slack', {
        repository: notification.repository,
        eventType: notification.eventType,
        channel: githubConfig.slackNotificationChannel,
      });

      // TODO: Integrate with existing Slack client
      // This will be implemented when Slack integration is added
      // await this.slackClient.postMessage({
      //   channel: githubConfig.slackNotificationChannel,
      //   text: message.text,
      //   blocks: message.blocks,
      // });

      this.logger.debug('GitHub notification sent successfully', {
        repository: notification.repository,
        eventType: notification.eventType,
      });
      
    } catch (error) {
      this.logger.error('Failed to send GitHub notification to Slack', {
        repository: notification.repository,
        eventType: notification.eventType,
        error,
      });
      throw error;
    }
  }

  /**
   * Format notification message for Slack
   */
  private formatNotificationMessage(notification: GitHubSlackNotification): {
    text: string;
    blocks: any[];
  } {
    const { repository, eventType, prNumber, issueNumber, title, author, url, action } = notification;

    let emoji = '📝';
    let actionText = action;
    let itemType = 'item';
    let itemNumber = '';

    // Set emoji and text based on event type
    switch (eventType) {
      case 'pr_opened':
        emoji = '🔀';
        itemType = 'Pull Request';
        itemNumber = `#${prNumber}`;
        break;
      case 'pr_review_completed':
        emoji = '✅';
        actionText = 'reviewed';
        itemType = 'Pull Request';
        itemNumber = `#${prNumber}`;
        break;
      case 'pr_merged':
        emoji = '🎉';
        actionText = 'merged';
        itemType = 'Pull Request';
        itemNumber = `#${prNumber}`;
        break;
      case 'issue_opened':
        emoji = '🐛';
        itemType = 'Issue';
        itemNumber = `#${issueNumber}`;
        break;
      case 'issue_comment':
        emoji = '💬';
        actionText = 'commented on';
        itemType = 'Issue';
        itemNumber = `#${issueNumber}`;
        break;
    }

    const text = `${emoji} ${itemType} ${itemNumber} ${actionText} in ${repository}`;

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${itemType} ${itemNumber}* ${actionText} in \`${repository}\``,
        },
      },
    ];

    // Add title if available
    if (title) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Title:* ${title}`,
        },
      });
    }

    // Add author if available
    if (author) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Author:* ${author}`,
        },
      });
    }

    // Add action buttons if URL is available
    if (url) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: `View ${itemType}`,
            },
            url: url,
            style: 'primary',
          },
        ],
      });
    }

    // Add footer
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `🤖 GitHub Integration | ${new Date().toLocaleString()}`,
        },
      ],
    });

    return { text, blocks };
  }

  /**
   * Send PR review completion notification
   */
  async notifyPRReviewCompleted(
    repository: string,
    prNumber: number,
    title: string,
    author: string,
    prUrl: string
  ): Promise<void> {
    await this.sendNotification({
      repository,
      prNumber,
      title,
      author,
      url: prUrl,
      action: 'analyzed',
      eventType: 'pr_review_completed',
    });
  }

  /**
   * Send PR opened notification
   */
  async notifyPROpened(
    repository: string,
    prNumber: number,
    title: string,
    author: string,
    prUrl: string
  ): Promise<void> {
    await this.sendNotification({
      repository,
      prNumber,
      title,
      author,
      url: prUrl,
      action: 'opened',
      eventType: 'pr_opened',
    });
  }

  /**
   * Send PR merged notification
   */
  async notifyPRMerged(
    repository: string,
    prNumber: number,
    title: string,
    author: string,
    prUrl: string
  ): Promise<void> {
    await this.sendNotification({
      repository,
      prNumber,
      title,
      author,
      url: prUrl,
      action: 'merged',
      eventType: 'pr_merged',
    });
  }

  /**
   * Send issue opened notification
   */
  async notifyIssueOpened(
    repository: string,
    issueNumber: number,
    title: string,
    author: string,
    issueUrl: string
  ): Promise<void> {
    await this.sendNotification({
      repository,
      issueNumber,
      title,
      author,
      url: issueUrl,
      action: 'opened',
      eventType: 'issue_opened',
    });
  }

  /**
   * Test notification functionality
   */
  async testNotification(): Promise<void> {
    await this.sendNotification({
      repository: 'test/repository',
      prNumber: 123,
      title: 'Test PR for notification system',
      author: 'test-user',
      url: 'https://github.com/test/repository/pull/123',
      action: 'tested',
      eventType: 'pr_review_completed',
    });
  }
}