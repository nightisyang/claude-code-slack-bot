import { Logger } from '../logger.js';
import { CommentAnalysis, CommentType } from './github-issue-analyzer.js';

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  warnings: string[];
  blockers: string[];
  recommendation: 'post' | 'review' | 'reject';
}

export interface SafetyRule {
  name: string;
  pattern: RegExp;
  severity: 'warning' | 'blocker';
  message: string;
}

export class GitHubResponseValidator {
  private logger = new Logger('GitHubResponseValidator');
  
  // Safety rules to prevent inappropriate responses
  private readonly safetyRules: SafetyRule[] = [
    {
      name: 'destructive_commands',
      pattern: /\b(rm -rf|del \/s|format|fdisk|kill -9|pkill|killall)\b/i,
      severity: 'blocker',
      message: 'Contains potentially destructive commands'
    },
    {
      name: 'credential_exposure',
      pattern: /(password|token|api_key|secret|private_key)\s*[:=]\s*[\w\-\.]{8,}/i,
      severity: 'blocker',
      message: 'May contain exposed credentials'
    },
    {
      name: 'personal_info',
      pattern: /\b(\d{3}-\d{2}-\d{4}|\d{16}|[\w\.-]+@[\w\.-]+\.\w+)\b/i,
      severity: 'warning',
      message: 'May contain personal information'
    },
    {
      name: 'security_vulnerabilities',
      pattern: /\b(eval|exec|shell|system|subprocess\.call)\s*\(/i,
      severity: 'warning',
      message: 'Contains potentially unsafe code patterns'
    },
    {
      name: 'inappropriate_language',
      pattern: /\b(damn|shit|fuck|stupid|idiot|moron)\b/i,
      severity: 'warning',
      message: 'Contains inappropriate language'
    },
    {
      name: 'absolute_statements',
      pattern: /\b(never works|always fails|impossible|can't be done|will never)\b/i,
      severity: 'warning',
      message: 'Contains absolute statements that may be incorrect'
    }
  ];

  /**
   * Validate a generated response before posting to GitHub
   */
  validateResponse(
    response: string, 
    analysis: CommentAnalysis, 
    confidence: number
  ): ValidationResult {
    const warnings: string[] = [];
    const blockers: string[] = [];

    this.logger.debug('Validating response', {
      responseLength: response.length,
      commentType: analysis.type,
      confidence,
    });

    // Basic validation checks
    const basicValidation = this.performBasicValidation(response);
    if (!basicValidation.isValid) {
      blockers.push(...basicValidation.blockers);
      warnings.push(...basicValidation.warnings);
    }

    // Safety rule checks
    const safetyValidation = this.performSafetyValidation(response);
    blockers.push(...safetyValidation.blockers);
    warnings.push(...safetyValidation.warnings);

    // Context-specific validation
    const contextValidation = this.performContextValidation(response, analysis);
    blockers.push(...contextValidation.blockers);
    warnings.push(...contextValidation.warnings);

    // Determine recommendation
    const recommendation = this.getRecommendation(blockers, warnings, confidence, analysis);

    const result: ValidationResult = {
      isValid: blockers.length === 0,
      confidence,
      warnings,
      blockers,
      recommendation,
    };

    this.logger.info('Response validation completed', {
      isValid: result.isValid,
      warningCount: warnings.length,
      blockerCount: blockers.length,
      recommendation,
      commentType: analysis.type,
    });

    return result;
  }

  /**
   * Perform basic validation checks
   */
  private performBasicValidation(response: string): { isValid: boolean; warnings: string[]; blockers: string[] } {
    const warnings: string[] = [];
    const blockers: string[] = [];

    // Check minimum length
    if (response.trim().length < 20) {
      blockers.push('Response too short (minimum 20 characters)');
    }

    // Check maximum length  
    if (response.length > 4000) {
      warnings.push('Response very long (may be overwhelming)');
    }

    // Check for empty response
    if (!response.trim()) {
      blockers.push('Empty response');
    }

    // Check for repetitive content
    if (this.hasRepetitiveContent(response)) {
      warnings.push('Response contains repetitive content');
    }

    // Check for incomplete sentences
    if (this.hasIncompleteEnding(response)) {
      warnings.push('Response may be incomplete');
    }

    return {
      isValid: blockers.length === 0,
      warnings,
      blockers,
    };
  }

  /**
   * Perform safety validation using predefined rules
   */
  private performSafetyValidation(response: string): { warnings: string[]; blockers: string[] } {
    const warnings: string[] = [];
    const blockers: string[] = [];

    for (const rule of this.safetyRules) {
      if (rule.pattern.test(response)) {
        const message = `${rule.name}: ${rule.message}`;
        
        if (rule.severity === 'blocker') {
          blockers.push(message);
        } else {
          warnings.push(message);
        }
      }
    }

    return { warnings, blockers };
  }

  /**
   * Perform context-specific validation
   */
  private performContextValidation(
    response: string, 
    analysis: CommentAnalysis
  ): { warnings: string[]; blockers: string[] } {
    const warnings: string[] = [];
    const blockers: string[] = [];

    // Validate based on comment type
    switch (analysis.type) {
      case CommentType.BUG_REPORT:
        if (!this.containsHelpfulBugResponse(response)) {
          warnings.push('Bug report response may not be sufficiently helpful');
        }
        break;

      case CommentType.QUESTION_TECHNICAL:
        if (!this.containsAnswerContent(response)) {
          warnings.push('Technical question response may not contain a clear answer');
        }
        break;

      case CommentType.FEATURE_REQUEST:
        if (this.makesImplementationPromises(response)) {
          warnings.push('Response makes implementation promises');
        }
        break;
    }

    // Check for first-time contributor appropriateness
    if (analysis.context.isFirstTime && !this.isWelcomingToNewContributor(response)) {
      warnings.push('Response may not be welcoming enough for first-time contributor');
    }

    return { warnings, blockers };
  }

  /**
   * Determine final recommendation based on validation results
   */
  private getRecommendation(
    blockers: string[], 
    warnings: string[], 
    confidence: number,
    analysis: CommentAnalysis
  ): 'post' | 'review' | 'reject' {
    // Reject if there are any blockers
    if (blockers.length > 0) {
      return 'reject';
    }

    // For automatic mode (per requirements), post unless there are serious issues
    if (warnings.length === 0 && confidence > 0.6) {
      return 'post';
    }

    if (warnings.length <= 2 && confidence > 0.5) {
      return 'post';
    }

    // If confidence is very low or many warnings, still post but log concerns
    if (confidence < 0.3 || warnings.length > 3) {
      // In automatic mode, we still post but log the concerns
      return 'post';
    }

    return 'post';
  }

  /**
   * Helper validation methods
   */
  private hasRepetitiveContent(response: string): boolean {
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
    return sentences.length > 3 && uniqueSentences.size < sentences.length * 0.8;
  }

  private hasIncompleteEnding(response: string): boolean {
    const trimmed = response.trim();
    return trimmed.length > 50 && !trimmed.match(/[.!?]$/);
  }

  private containsHelpfulBugResponse(response: string): boolean {
    const helpfulIndicators = [
      'reproduce', 'steps', 'environment', 'version', 'workaround', 
      'fix', 'solution', 'debug', 'investigate'
    ];
    const lowercaseResponse = response.toLowerCase();
    return helpfulIndicators.some(indicator => lowercaseResponse.includes(indicator));
  }

  private containsAnswerContent(response: string): boolean {
    const answerIndicators = [
      'you can', 'try', 'use', 'here\'s how', 'solution', 'answer', 
      'example', 'like this', 'as follows'
    ];
    const lowercaseResponse = response.toLowerCase();
    return answerIndicators.some(indicator => lowercaseResponse.includes(indicator));
  }

  private makesImplementationPromises(response: string): boolean {
    const promiseIndicators = [
      'will implement', 'will add', 'will be added', 'coming soon', 
      'next release', 'will fix', 'we will'
    ];
    const lowercaseResponse = response.toLowerCase();
    return promiseIndicators.some(indicator => lowercaseResponse.includes(indicator));
  }

  private isWelcomingToNewContributor(response: string): boolean {
    const welcomeIndicators = [
      'welcome', 'thanks for', 'appreciate', 'great question', 
      'happy to help', 'glad you', 'thank you'
    ];
    const lowercaseResponse = response.toLowerCase();
    return welcomeIndicators.some(indicator => lowercaseResponse.includes(indicator));
  }

  /**
   * Get validation statistics for monitoring
   */
  getValidationStats(): any {
    return {
      totalRules: this.safetyRules.length,
      blockerRules: this.safetyRules.filter(r => r.severity === 'blocker').length,
      warningRules: this.safetyRules.filter(r => r.severity === 'warning').length,
    };
  }
}