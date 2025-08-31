import { Logger } from '../logger.js';
import { ClaudeHandler } from '../claude-handler.js';
import { GitHubApiClient } from './github-api-client.js';
import { GitHubRepositoryManager } from './github-repository-manager.js';
import { IssueCommentPayload } from './github-types.js';
import { githubConfig } from './github-config.js';

export interface ClaudeProcessorResult {
  shouldRespond: boolean;
  response?: string;
  reasoning?: string;
  confidence?: number;
  exploredFiles?: string[];
}

export class GitHubClaudeProcessor {
  private logger = new Logger('GitHubClaudeProcessor');
  private claudeHandler: ClaudeHandler;
  private apiClient: GitHubApiClient;
  private repositoryManager: GitHubRepositoryManager;

  constructor(claudeHandler: ClaudeHandler, apiClient: GitHubApiClient) {
    this.claudeHandler = claudeHandler;
    this.apiClient = apiClient;
    this.repositoryManager = new GitHubRepositoryManager();
  }

  /**
   * Process issue comment using Claude AI for both classification and response
   */
  async processIssueComment(payload: IssueCommentPayload): Promise<ClaudeProcessorResult> {
    const { issue, comment, repository } = payload;
    const [owner, repo] = repository.full_name.split('/');

    this.logger.info('Processing issue comment with Claude', {
      repository: repository.full_name,
      issueNumber: issue.number,
      commentId: comment.id,
      author: comment.user.login,
    });

    // Author whitelist check is now handled in the webhook handler before this is called
    // So we can trust that if we get here, the author is already whitelisted

    let repoInfo = null;
    
    try {
      // Get installation token for repository access
      const installationToken = await this.apiClient['getInstallationToken']();
      
      // Ensure repository is cloned locally
      repoInfo = await this.repositoryManager.ensureRepository(owner, repo, installationToken);
      
      // Create a session for GitHub issue analysis
      const sessionKey = `github-${owner}-${repo}-${issue.number}-${Date.now()}`;
      const session = this.claudeHandler.createSession('github-bot', 'github-claude', sessionKey);
      
      // Set working directory to repository
      session.workingDirectory = repoInfo.localPath;
      
      // Get comment history for context
      const commentHistory = await this.getCommentHistory(payload);
      
      // Build comprehensive prompt for Claude
      const prompt = this.buildClaudePrompt(payload, commentHistory);
      
      // Get Claude's analysis and response
      let claudeOutput = '';
      for await (const message of this.claudeHandler.streamQuery(
        prompt,
        session,
        undefined,
        repoInfo.localPath
      )) {
        if (message.content && typeof message.content === 'string') {
          claudeOutput += message.content;
        }
      }
      
      // Parse Claude's structured response
      const result = this.parseClaudeResponse(claudeOutput);
      
      this.logger.info('Claude processing completed', {
        shouldRespond: result.shouldRespond,
        confidence: result.confidence,
        reasoning: result.reasoning,
        exploredFiles: result.exploredFiles?.length || 0,
      });
      
      return result;
      
    } catch (error) {
      this.logger.error('Failed to process issue comment with Claude', {
        repository: repository.full_name,
        issueNumber: issue.number,
        commentId: comment.id,
        error,
      });
      
      return {
        shouldRespond: false,
        reasoning: `Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
      
    } finally {
      // Cleanup repository after analysis
      if (repoInfo) {
        await this.repositoryManager.cleanup(repoInfo);
      }
    }
  }

  /**
   * Get comment history for context
   */
  private async getCommentHistory(payload: IssueCommentPayload): Promise<string> {
    const { issue, repository } = payload;
    const [owner, repo] = repository.full_name.split('/');
    
    try {
      const comments = await this.apiClient.makePublicApiRequest<any[]>(
        `/repos/${owner}/${repo}/issues/${issue.number}/comments`
      );
      
      // Get last 5 comments for context (excluding the current one)
      const currentCommentId = payload.comment.id;
      const recentComments = comments
        .filter(c => c.id !== currentCommentId)
        .slice(-5);
      
      if (recentComments.length === 0) {
        return 'No previous comments';
      }
      
      return recentComments
        .map(c => {
          const preview = c.body.substring(0, 200);
          const truncated = c.body.length > 200 ? '...' : '';
          return `[${c.user.login}]: ${preview}${truncated}`;
        })
        .join('\n\n');
        
    } catch (error) {
      this.logger.warn('Failed to fetch comment history', { error });
      return 'Unable to fetch comment history';
    }
  }

  /**
   * Build comprehensive prompt for Claude
   */
  private buildClaudePrompt(payload: IssueCommentPayload, commentHistory: string): string {
    const { issue, comment, repository } = payload;
    
    return `You are an AI assistant helping with GitHub issues for the repository ${repository.full_name}.
Your task is to analyze an issue comment and decide whether to respond, and if so, generate a helpful response.

## Your Capabilities
- You have full access to the repository files through the Read and Grep tools
- You can search for code patterns, read documentation, and understand the codebase
- You should explore relevant files to provide accurate, context-aware responses

## Issue Context
**Issue #${issue.number}: ${issue.title}**
- State: ${issue.state}
- Labels: ${issue.labels.map((l: any) => l.name).join(', ') || 'None'}
- Created by: ${issue.user.login}
- Issue Description:
${issue.body || 'No description provided'}

## New Comment
**Author:** ${comment.user.login}
**Comment:**
${comment.body}

## Previous Comments
${commentHistory}

## Decision Guidelines

### SHOULD RESPOND when:
- The comment is a technical question that you can answer
- It's a bug report where you can help diagnose or suggest solutions
- It's a feature request where you can provide implementation guidance
- The user needs help understanding the codebase or documentation
- You can provide valuable insights or suggestions
- The comment explicitly asks for help or clarification

### SHOULD NOT RESPOND when:
- The comment is from a bot (username contains "bot" or user type is "Bot")
- The comment is very short (under 10 characters) or just an acknowledgment
- The comment is spam, offensive, or off-topic
- You've already responded recently in this thread (check comment history)
- The comment doesn't need a response (e.g., "Thanks!", "LGTM", "+1", "👍")
- The issue is closed and the comment doesn't add new information
- The comment is just a status update or progress report
- Another human has already adequately answered the question

## Your Task

1. First, explore the repository to understand the context better. Use the Grep and Read tools to:
   - Find relevant code mentioned in the issue/comment
   - Understand the project structure
   - Look for similar issues or patterns in the codebase
   - Check documentation that might help
   - Look for existing examples or test cases

2. Decide whether to respond based on the guidelines above.

3. If you should respond, generate a helpful, professional response that:
   - Directly addresses the comment
   - Includes code examples when relevant (use markdown formatting)
   - References specific files or functions from the repository when applicable (use format: \`path/to/file.ts:123\`)
   - Is welcoming to first-time contributors (if this is their first comment)
   - Doesn't make promises about implementation timelines
   - Admits uncertainty rather than guessing
   - Is concise but thorough (aim for 2-4 paragraphs maximum)

## Output Format

Please structure your output EXACTLY as follows:

### DECISION
[Write exactly "RESPOND" or "SKIP" - nothing else on this line]

### REASONING
[Brief explanation of why you decided to respond or skip - 1-2 sentences]

### CONFIDENCE
[A single decimal number between 0.0 and 1.0 indicating your confidence in this decision]

### EXPLORED_FILES
[List any files you examined, one per line, or write "None" if you didn't explore any files]

### RESPONSE
[Your complete response to post on GitHub - only include this section if DECISION is RESPOND]
[Do not include any bot signature or footer - this will be added automatically]
[Write in a helpful, professional tone]
[Use markdown formatting for code blocks and file references]

Remember:
- Be helpful and professional
- Use your tools to explore the repository and provide accurate information
- Format code examples properly with markdown
- Reference specific files when relevant
- Don't repeat information that's already been provided in previous comments`;
  }

  /**
   * Parse Claude's structured response
   */
  private parseClaudeResponse(output: string): ClaudeProcessorResult {
    this.logger.debug('Parsing Claude output', { outputLength: output.length });
    
    // Split by ### headers and process each section
    const sections: { [key: string]: string } = {};
    const sectionMatches = output.matchAll(/###\s*([A-Z_]+)\s*\n([\s\S]*?)(?=###|$)/g);
    
    for (const match of sectionMatches) {
      const sectionName = match[1].trim();
      const sectionContent = match[2].trim();
      sections[sectionName] = sectionContent;
    }
    
    // Extract values from sections
    const decision = sections['DECISION']?.toUpperCase().trim();
    const reasoning = sections['REASONING'] || 'No reasoning provided';
    const confidenceStr = sections['CONFIDENCE']?.trim();
    const confidence = confidenceStr ? parseFloat(confidenceStr) : 0.5;
    
    const exploredFilesSection = sections['EXPLORED_FILES'];
    const exploredFiles = exploredFilesSection && exploredFilesSection !== 'None'
      ? exploredFilesSection.split('\n').filter(f => f.trim() && f.trim() !== 'None')
      : [];
    
    const response = sections['RESPONSE'];
    
    this.logger.debug('Parsed sections', {
      decision,
      hasResponse: !!response,
      confidence,
      exploredFilesCount: exploredFiles.length,
    });
    
    if (decision === 'RESPOND' && response) {
      // Add bot signature to the response
      const finalResponse = `${response}

---
*🤖 This response was generated by Claude Code AI. If you need further assistance, please let me know!*`;
      
      return {
        shouldRespond: true,
        response: finalResponse,
        reasoning,
        confidence: isNaN(confidence) ? 0.5 : Math.min(1, Math.max(0, confidence)),
        exploredFiles: exploredFiles.length > 0 ? exploredFiles : undefined,
      };
    }
    
    return {
      shouldRespond: false,
      reasoning,
      confidence: isNaN(confidence) ? 0.5 : Math.min(1, Math.max(0, confidence)),
      exploredFiles: exploredFiles.length > 0 ? exploredFiles : undefined,
    };
  }
}