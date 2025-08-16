import { Logger } from '../logger.js';
import { GitHubApiClient } from './github-api-client.js';
import { GitHubRepositoryManager, RepositoryInfo } from './github-repository-manager.js';
import { IssueCommentPayload } from './github-types.js';

export enum CommentType {
  QUESTION_TECHNICAL = 'question_technical',
  BUG_REPORT = 'bug_report',
  FEATURE_REQUEST = 'feature_request',
  DOCUMENTATION = 'documentation',
  SUPPORT = 'support',
  DISCUSSION = 'discussion',
  SPAM_OR_INVALID = 'spam_or_invalid'
}

export interface CommentAnalysis {
  type: CommentType;
  confidence: number;
  shouldRespond: boolean;
  context: {
    issueTitle: string;
    issueBody: string;
    commentBody: string;
    labels: string[];
    repository: string;
    author: string;
    isFirstTime: boolean;
  };
  relevantFiles: string[];
  repositoryContext: string;
}

export interface IssueContext {
  issue: any;
  comment: any;
  repository: any;
  allComments: any[];
  relevantFiles: string[];
  repositoryStructure: string;
}

export class GitHubIssueAnalyzer {
  private logger = new Logger('GitHubIssueAnalyzer');
  private apiClient: GitHubApiClient;
  private repositoryManager: GitHubRepositoryManager;

  constructor(apiClient: GitHubApiClient) {
    this.apiClient = apiClient;
    this.repositoryManager = new GitHubRepositoryManager();
  }

  /**
   * Analyze an issue comment to determine if and how to respond
   */
  async analyzeComment(payload: IssueCommentPayload): Promise<CommentAnalysis> {
    const { issue, comment, repository } = payload;
    const [owner, repo] = repository.full_name.split('/');

    this.logger.info('Analyzing issue comment', {
      repository: repository.full_name,
      issueNumber: issue.number,
      commentId: comment.id,
      author: comment.user.login,
    });

    try {
      // Gather full context
      const context = await this.gatherIssueContext(owner, repo, issue, comment);
      
      // Classify comment type
      const classification = await this.classifyComment(context);
      
      // Determine if we should respond
      const shouldRespond = this.shouldRespondToComment(classification, context);
      
      // Find relevant files
      const relevantFiles = await this.findRelevantFiles(context);
      
      // Build repository context
      const repositoryContext = await this.buildRepositoryContext(owner, repo, relevantFiles);

      return {
        type: classification.type,
        confidence: classification.confidence,
        shouldRespond,
        context: {
          issueTitle: issue.title,
          issueBody: issue.body || '',
          commentBody: comment.body,
          labels: issue.labels.map((label: any) => label.name),
          repository: repository.full_name,
          author: comment.user.login,
          isFirstTime: context.allComments.filter(c => c.user.login === comment.user.login).length === 1,
        },
        relevantFiles,
        repositoryContext,
      };

    } catch (error) {
      this.logger.error('Failed to analyze comment', {
        repository: repository.full_name,
        issueNumber: issue.number,
        commentId: comment.id,
        error,
      });
      
      // Return safe default - don't respond on analysis failure
      return {
        type: CommentType.SPAM_OR_INVALID,
        confidence: 0,
        shouldRespond: false,
        context: {
          issueTitle: issue.title,
          issueBody: issue.body || '',
          commentBody: comment.body,
          labels: issue.labels.map((label: any) => label.name),
          repository: repository.full_name,
          author: comment.user.login,
          isFirstTime: false,
        },
        relevantFiles: [],
        repositoryContext: '',
      };
    }
  }

  /**
   * Gather comprehensive context about the issue and comment
   */
  private async gatherIssueContext(
    owner: string, 
    repo: string, 
    issue: any, 
    comment: any
  ): Promise<IssueContext> {
    // Get full issue details (in case webhook payload is incomplete)
    const fullIssue = await this.apiClient.getIssue(owner, repo, issue.number);
    
    // Get all comments on the issue for context
    const allComments = await this.apiClient.makePublicApiRequest<any[]>(
      `/repos/${owner}/${repo}/issues/${issue.number}/comments`
    );
    
    // Get repository details
    const repository = await this.apiClient.getRepository(owner, repo);

    return {
      issue: fullIssue,
      comment,
      repository,
      allComments,
      relevantFiles: [],
      repositoryStructure: '',
    };
  }

  /**
   * Classify the type of comment
   */
  private async classifyComment(context: IssueContext): Promise<{ type: CommentType; confidence: number }> {
    const { comment, issue } = context;
    const commentText = comment.body.toLowerCase();
    const issueTitle = issue.title.toLowerCase();
    
    // Simple heuristic-based classification (could be enhanced with AI)
    
    // Check for question indicators
    if (this.containsQuestionIndicators(commentText)) {
      return { type: CommentType.QUESTION_TECHNICAL, confidence: 0.8 };
    }
    
    // Check for bug report indicators
    if (this.containsBugIndicators(commentText) || issue.labels.some((l: any) => l.name.includes('bug'))) {
      return { type: CommentType.BUG_REPORT, confidence: 0.7 };
    }
    
    // Check for feature request indicators
    if (this.containsFeatureIndicators(commentText) || issue.labels.some((l: any) => l.name.includes('feature'))) {
      return { type: CommentType.FEATURE_REQUEST, confidence: 0.7 };
    }
    
    // Check for documentation requests
    if (this.containsDocumentationIndicators(commentText)) {
      return { type: CommentType.DOCUMENTATION, confidence: 0.6 };
    }
    
    // Check for support requests
    if (this.containsSupportIndicators(commentText)) {
      return { type: CommentType.SUPPORT, confidence: 0.6 };
    }
    
    // Default to discussion
    return { type: CommentType.DISCUSSION, confidence: 0.5 };
  }

  /**
   * Determine if we should respond to this comment
   */
  private shouldRespondToComment(
    classification: { type: CommentType; confidence: number },
    context: IssueContext
  ): boolean {
    // Don't respond to bot comments
    if (context.comment.user.type === 'Bot') {
      return false;
    }
    
    // Don't respond to our own comments
    if (context.comment.user.login.includes('claude') || context.comment.user.login.includes('bot')) {
      return false;
    }
    
    // Don't respond to spam or invalid comments
    if (classification.type === CommentType.SPAM_OR_INVALID) {
      return false;
    }
    
    // Don't respond to very short comments (likely acknowledgments)
    if (context.comment.body.trim().length < 10) {
      return false;
    }
    
    // Respond to all other valid comment types (per requirements)
    return true;
  }

  /**
   * Find files relevant to the issue/comment
   */
  private async findRelevantFiles(context: IssueContext): Promise<string[]> {
    const { issue, comment, repository } = context;
    const relevantFiles: string[] = [];
    
    // Extract file mentions from issue and comment text
    const allText = `${issue.title} ${issue.body} ${comment.body}`;
    const filePattern = /[\w\-/]+\.(ts|js|tsx|jsx|py|java|cpp|c|h|md|json|yaml|yml|html|css|scss|sql)/gi;
    const mentions = allText.match(filePattern) || [];
    
    relevantFiles.push(...mentions);
    
    // Add common files based on issue type
    if (issue.labels.some((l: any) => l.name.includes('bug'))) {
      relevantFiles.push('README.md', 'package.json', 'tsconfig.json');
    }
    
    if (issue.labels.some((l: any) => l.name.includes('documentation'))) {
      relevantFiles.push('README.md', 'docs/', 'CONTRIBUTING.md');
    }
    
    // Remove duplicates and return
    return [...new Set(relevantFiles)];
  }

  /**
   * Build repository context for AI analysis
   */
  private async buildRepositoryContext(
    owner: string, 
    repo: string, 
    relevantFiles: string[]
  ): Promise<string> {
    let context = `Repository: ${owner}/${repo}\n\n`;
    
    try {
      // Get repository structure
      const repoInfo = await this.repositoryManager.ensureRepository(owner, repo, await this.apiClient['getInstallationToken']());
      
      // Add basic project structure
      context += `Project Structure:\n`;
      context += `- Root directory: ${repoInfo.localPath}\n`;
      
      // Add relevant file contents (limited to avoid token overload)
      if (relevantFiles.length > 0) {
        context += `\nRelevant Files:\n`;
        for (const file of relevantFiles.slice(0, 5)) { // Limit to 5 files
          try {
            const content = await this.repositoryManager.readFile(repoInfo, file);
            if (content && content.length < 2000) { // Limit file content size
              context += `\n${file}:\n\`\`\`\n${content}\n\`\`\`\n`;
            }
          } catch (error) {
            // File doesn't exist or can't be read - skip silently
          }
        }
      }
      
      // Cleanup repository
      await this.repositoryManager.cleanup(repoInfo);
      
    } catch (error) {
      this.logger.warn('Failed to build repository context', { owner, repo, error });
      context += 'Repository context unavailable due to access limitations.\n';
    }
    
    return context;
  }

  /**
   * Helper methods for comment classification
   */
  private containsQuestionIndicators(text: string): boolean {
    const questionWords = ['how', 'what', 'why', 'when', 'where', 'which', 'who', '?'];
    const questionPhrases = ['can you', 'could you', 'would you', 'help me', 'how do i', 'how to'];
    
    return questionWords.some(word => text.includes(word)) || 
           questionPhrases.some(phrase => text.includes(phrase));
  }

  private containsBugIndicators(text: string): boolean {
    const bugWords = ['bug', 'error', 'issue', 'problem', 'broken', 'crash', 'fail', 'exception', 'stacktrace'];
    return bugWords.some(word => text.includes(word));
  }

  private containsFeatureIndicators(text: string): boolean {
    const featureWords = ['feature', 'enhancement', 'suggestion', 'request', 'add', 'implement', 'support'];
    const featurePhrases = ['would be nice', 'it would be great', 'can we add', 'please add'];
    
    return featureWords.some(word => text.includes(word)) ||
           featurePhrases.some(phrase => text.includes(phrase));
  }

  private containsDocumentationIndicators(text: string): boolean {
    const docWords = ['documentation', 'docs', 'readme', 'guide', 'tutorial', 'example', 'explain'];
    const docPhrases = ['how does', 'what does', 'where is documented'];
    
    return docWords.some(word => text.includes(word)) ||
           docPhrases.some(phrase => text.includes(phrase));
  }

  private containsSupportIndicators(text: string): boolean {
    const supportWords = ['help', 'support', 'assistance', 'stuck', 'confused', 'understand'];
    const supportPhrases = ['need help', 'can someone', 'please help'];
    
    return supportWords.some(word => text.includes(word)) ||
           supportPhrases.some(phrase => text.includes(phrase));
  }
}