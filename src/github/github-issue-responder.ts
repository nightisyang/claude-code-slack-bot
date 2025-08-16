import { Logger } from '../logger.js';
import { ClaudeHandler } from '../claude-handler.js';
import { GitHubApiClient } from './github-api-client.js';
import { GitHubIssueAnalyzer, CommentAnalysis, CommentType } from './github-issue-analyzer.js';
import { IssueCommentPayload } from './github-types.js';

export interface ResponseResult {
  success: boolean;
  responseGenerated: boolean;
  responsePosted: boolean;
  commentId?: number;
  error?: string;
  confidence: number;
  responsePreview: string;
}

export class GitHubIssueResponder {
  private logger = new Logger('GitHubIssueResponder');
  private claudeHandler: ClaudeHandler;
  private apiClient: GitHubApiClient;
  private analyzer: GitHubIssueAnalyzer;

  constructor(claudeHandler: ClaudeHandler, apiClient: GitHubApiClient) {
    this.claudeHandler = claudeHandler;
    this.apiClient = apiClient;
    this.analyzer = new GitHubIssueAnalyzer(apiClient);
  }

  /**
   * Process issue comment and generate automated response
   */
  async processIssueComment(payload: IssueCommentPayload): Promise<ResponseResult> {
    const { issue, comment, repository } = payload;
    const [owner, repo] = repository.full_name.split('/');

    this.logger.info('Processing issue comment for automated response', {
      repository: repository.full_name,
      issueNumber: issue.number,
      commentId: comment.id,
      author: comment.user.login,
    });

    try {
      // Analyze the comment first
      const analysis = await this.analyzer.analyzeComment(payload);

      if (!analysis.shouldRespond) {
        this.logger.info('Skipping response based on analysis', {
          repository: repository.full_name,
          issueNumber: issue.number,
          commentType: analysis.type,
          confidence: analysis.confidence,
        });

        return {
          success: true,
          responseGenerated: false,
          responsePosted: false,
          confidence: analysis.confidence,
          responsePreview: 'No response needed',
        };
      }

      // Generate response using Claude
      const response = await this.generateResponse(analysis);

      if (!response) {
        return {
          success: false,
          responseGenerated: false,
          responsePosted: false,
          confidence: analysis.confidence,
          responsePreview: '',
          error: 'Failed to generate response',
        };
      }

      // Post response to GitHub
      const githubComment = await this.apiClient.createIssueComment(
        owner,
        repo,
        issue.number,
        response
      );

      this.logger.info('Automated response posted successfully', {
        repository: repository.full_name,
        issueNumber: issue.number,
        commentId: githubComment.id,
        responseLength: response.length,
        confidence: analysis.confidence,
      });

      return {
        success: true,
        responseGenerated: true,
        responsePosted: true,
        commentId: githubComment.id,
        confidence: analysis.confidence,
        responsePreview: response.substring(0, 200) + (response.length > 200 ? '...' : ''),
      };

    } catch (error) {
      this.logger.error('Failed to process issue comment', {
        repository: repository.full_name,
        issueNumber: issue.number,
        commentId: comment.id,
        error,
      });

      return {
        success: false,
        responseGenerated: false,
        responsePosted: false,
        confidence: 0,
        responsePreview: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate intelligent response using Claude AI
   */
  private async generateResponse(analysis: CommentAnalysis): Promise<string> {
    const prompt = this.buildResponsePrompt(analysis);
    
    // Create a session for GitHub issue response
    const sessionKey = `github-issue-${analysis.context.repository.replace('/', '-')}-${Date.now()}`;
    const session = this.claudeHandler.createSession('github-bot', 'github-issue-response', sessionKey);
    
    // Set working directory if we have repository context
    if (analysis.repositoryContext) {
      // Extract working directory from context if available
      const repoMatch = analysis.repositoryContext.match(/Root directory: (.+)/);
      if (repoMatch) {
        session.workingDirectory = repoMatch[1];
      }
    }

    let responseContent = '';
    
    try {
      // Stream response from Claude
      for await (const message of this.claudeHandler.streamQuery(
        prompt,
        session,
        undefined,
        session.workingDirectory
      )) {
        if (message.content && typeof message.content === 'string') {
          responseContent += message.content;
        }
      }
      
      // Format and clean the response
      const formattedResponse = this.formatResponse(responseContent, analysis);
      return formattedResponse;
      
    } catch (error) {
      this.logger.error('Failed to generate response with Claude', {
        sessionKey,
        error,
      });
      throw error;
    }
  }

  /**
   * Build prompt for Claude based on comment analysis
   */
  private buildResponsePrompt(analysis: CommentAnalysis): string {
    const { context, type, repositoryContext } = analysis;
    
    let prompt = `You are an AI assistant helping with GitHub issue responses. Please provide a helpful, accurate, and professional response to the following issue comment.

**Issue Information:**
- Repository: ${context.repository}
- Issue Title: ${context.issueTitle}
- Issue Description: ${context.issueBody}
- Labels: ${context.labels.join(', ') || 'None'}

**Comment to Respond To:**
- Author: ${context.author}
- Comment Type: ${type}
- Is First-Time Contributor: ${context.isFirstTime}
- Comment: ${context.commentBody}

**Repository Context:**
${repositoryContext}

**Response Guidelines:**
`;

    // Add specific guidelines based on comment type
    switch (type) {
      case CommentType.QUESTION_TECHNICAL:
        prompt += `- This is a technical question. Provide a clear, detailed answer.
- Include code examples if relevant.
- Reference specific files or functions from the repository if applicable.
- If you can't answer definitively, suggest debugging steps or resources.`;
        break;
        
      case CommentType.BUG_REPORT:
        prompt += `- This appears to be a bug report. Help diagnose the issue.
- Ask for additional information if needed (reproduction steps, environment, etc.).
- Suggest potential workarounds if you can identify the issue.
- Reference similar issues or known fixes from the repository.`;
        break;
        
      case CommentType.FEATURE_REQUEST:
        prompt += `- This is a feature request. Provide thoughtful feedback.
- Discuss implementation considerations or challenges.
- Suggest alternative approaches if the request seems problematic.
- Reference existing similar functionality in the codebase if applicable.`;
        break;
        
      case CommentType.DOCUMENTATION:
        prompt += `- This is about documentation. Help clarify or point to resources.
- Provide clear explanations with examples.
- Reference existing documentation where helpful.
- Suggest improvements to documentation if gaps are identified.`;
        break;
        
      case CommentType.SUPPORT:
        prompt += `- This is a support request. Provide helpful guidance.
- Be patient and welcoming, especially for new contributors.
- Break down complex solutions into steps.
- Provide links to relevant documentation or examples.`;
        break;
        
      default:
        prompt += `- Engage constructively with the discussion.
- Provide helpful insights or ask clarifying questions.
- Be supportive and professional.`;
    }

    prompt += `

**Important:**
- Be concise but thorough - aim for 2-4 paragraphs maximum
- Use a helpful, professional tone
- Include code examples in markdown format when relevant
- Don't make promises about implementation timelines
- If you're unsure about something, say so rather than guessing
- Welcome first-time contributors warmly

**Format your response as a GitHub comment (markdown supported).**`;

    return prompt;
  }

  /**
   * Format the response from Claude for GitHub
   */
  private formatResponse(claudeResponse: string, analysis: CommentAnalysis): string {
    // Clean up the response and add bot signature
    let response = claudeResponse.trim();
    
    // Remove any prompt artifacts or meta-commentary
    response = response.replace(/^(Here's a response|I'll respond|Here's my response).*?\n\n/i, '');
    response = response.replace(/^(Response:|Answer:)\s*/i, '');
    
    // Add welcoming message for first-time contributors
    if (analysis.context.isFirstTime) {
      response = `Welcome to the project, @${analysis.context.author}! 👋\n\n${response}`;
    }
    
    // Add bot signature
    response += `\n\n---\n*🤖 This response was generated automatically by Claude Code AI. If you need further assistance, please let us know!*`;
    
    return response;
  }

  /**
   * Validate that a response is appropriate to post
   */
  private validateResponse(response: string, analysis: CommentAnalysis): boolean {
    // Basic validation checks
    if (!response || response.trim().length < 50) {
      return false;
    }
    
    // Check for inappropriate content (basic)
    const inappropriatePatterns = [
      /\b(delete|remove|rm -rf)\b.*\b(everything|all|\/)\b/i,
      /\b(hack|crack|exploit)\b/i,
      /\b(password|secret|token)\s*[:=]\s*\w+/i,
    ];
    
    if (inappropriatePatterns.some(pattern => pattern.test(response))) {
      return false;
    }
    
    // Response looks appropriate
    return true;
  }
}