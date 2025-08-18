import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../logger.js';
import { githubConfig } from './github-config.js';

const execAsync = promisify(exec);

export interface RepositoryInfo {
  owner: string;
  repo: string;
  fullName: string;
  localPath: string;
  cloneUrl: string;
}

export interface PullRequestFiles {
  modified: string[];
  added: string[];
  removed: string[];
  all: string[];
}

export class GitHubRepositoryManager {
  private logger = new Logger('GitHubRepositoryManager');
  private readonly baseRepoDir: string;

  constructor() {
    // Use temporary directory for repository clones
    this.baseRepoDir = path.join(process.cwd(), 'temp', 'repositories');
  }

  /**
   * Ensure repository is cloned locally and up to date
   */
  async ensureRepository(owner: string, repo: string, installationToken: string): Promise<RepositoryInfo> {
    const repoInfo: RepositoryInfo = {
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      localPath: path.join(this.baseRepoDir, owner, repo),
      cloneUrl: `https://x-access-token:${installationToken}@github.com/${owner}/${repo}.git`,
    };

    this.logger.info('Ensuring repository is available locally', {
      repository: repoInfo.fullName,
      localPath: repoInfo.localPath,
    });

    try {
      // Create base directory if it doesn't exist
      await fs.mkdir(this.baseRepoDir, { recursive: true });

      // Check if repository already exists locally
      const repoExists = await this.repositoryExists(repoInfo.localPath);

      if (repoExists) {
        this.logger.debug('Repository exists locally, updating', { repository: repoInfo.fullName });
        await this.updateRepository(repoInfo);
      } else {
        this.logger.debug('Cloning repository', { repository: repoInfo.fullName });
        await this.cloneRepository(repoInfo);
      }

      return repoInfo;
    } catch (error) {
      this.logger.error('Failed to ensure repository', {
        repository: repoInfo.fullName,
        error,
      });
      throw error;
    }
  }

  /**
   * Check out a specific pull request branch
   */
  async checkoutPullRequest(repoInfo: RepositoryInfo, prNumber: number): Promise<void> {
    this.logger.info('Checking out pull request branch', {
      repository: repoInfo.fullName,
      prNumber,
    });

    try {
      // Fetch the pull request branch
      await execAsync(`git fetch origin pull/${prNumber}/head:pr-${prNumber}`, {
        cwd: repoInfo.localPath,
      });

      // Checkout the pull request branch
      await execAsync(`git checkout pr-${prNumber}`, {
        cwd: repoInfo.localPath,
      });

      this.logger.debug('Successfully checked out PR branch', {
        repository: repoInfo.fullName,
        prNumber,
        branch: `pr-${prNumber}`,
      });
    } catch (error) {
      this.logger.error('Failed to checkout pull request branch', {
        repository: repoInfo.fullName,
        prNumber,
        error,
      });
      throw error;
    }
  }

  /**
   * Get list of files changed in the current pull request
   */
  async getPullRequestFiles(repoInfo: RepositoryInfo, baseBranch: string = 'main'): Promise<PullRequestFiles> {
    this.logger.debug('Getting pull request changed files', {
      repository: repoInfo.fullName,
      baseBranch,
    });

    try {
      // Get modified files
      const { stdout: modifiedFiles } = await execAsync(
        `git diff --name-only --diff-filter=M ${baseBranch}`,
        { cwd: repoInfo.localPath }
      );

      // Get added files
      const { stdout: addedFiles } = await execAsync(
        `git diff --name-only --diff-filter=A ${baseBranch}`,
        { cwd: repoInfo.localPath }
      );

      // Get removed files
      const { stdout: removedFiles } = await execAsync(
        `git diff --name-only --diff-filter=D ${baseBranch}`,
        { cwd: repoInfo.localPath }
      );

      // Get all changed files
      const { stdout: allFiles } = await execAsync(
        `git diff --name-only ${baseBranch}`,
        { cwd: repoInfo.localPath }
      );

      const result: PullRequestFiles = {
        modified: this.parseFileList(modifiedFiles),
        added: this.parseFileList(addedFiles),
        removed: this.parseFileList(removedFiles),
        all: this.parseFileList(allFiles),
      };

      this.logger.debug('Retrieved pull request file changes', {
        repository: repoInfo.fullName,
        modified: result.modified.length,
        added: result.added.length,
        removed: result.removed.length,
        total: result.all.length,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to get pull request files', {
        repository: repoInfo.fullName,
        baseBranch,
        error,
      });
      throw error;
    }
  }

  /**
   * Get the diff content for analysis
   */
  async getPullRequestDiff(repoInfo: RepositoryInfo, baseBranch: string = 'main'): Promise<string> {
    this.logger.debug('Getting pull request diff', {
      repository: repoInfo.fullName,
      baseBranch,
    });

    try {
      const { stdout: diff } = await execAsync(
        `git diff ${baseBranch}`,
        { cwd: repoInfo.localPath }
      );

      return diff;
    } catch (error) {
      this.logger.error('Failed to get pull request diff', {
        repository: repoInfo.fullName,
        baseBranch,
        error,
      });
      throw error;
    }
  }

  /**
   * Read file content from the repository
   */
  async readFile(repoInfo: RepositoryInfo, filePath: string): Promise<string> {
    const fullPath = path.join(repoInfo.localPath, filePath);
    
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      this.logger.error('Failed to read file', {
        repository: repoInfo.fullName,
        filePath,
        error,
      });
      throw error;
    }
  }

  /**
   * Clean up repository (delete local copy)
   */
  async cleanup(repoInfo: RepositoryInfo): Promise<void> {
    this.logger.info('Cleaning up repository', {
      repository: repoInfo.fullName,
      localPath: repoInfo.localPath,
    });

    try {
      await fs.rm(repoInfo.localPath, { recursive: true, force: true });
      this.logger.debug('Repository cleanup completed', {
        repository: repoInfo.fullName,
      });
    } catch (error) {
      this.logger.error('Failed to cleanup repository', {
        repository: repoInfo.fullName,
        error,
      });
      // Don't throw error for cleanup failures
    }
  }

  /**
   * Clean up all repositories older than specified hours
   */
  async cleanupOldRepositories(maxAgeHours: number = 24): Promise<void> {
    this.logger.info('Cleaning up old repositories', { maxAgeHours });

    try {
      const baseExists = await fs.access(this.baseRepoDir).then(() => true).catch(() => false);
      if (!baseExists) {
        return;
      }

      const owners = await fs.readdir(this.baseRepoDir);
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);

      for (const owner of owners) {
        const ownerDir = path.join(this.baseRepoDir, owner);
        const repos = await fs.readdir(ownerDir);

        for (const repo of repos) {
          const repoDir = path.join(ownerDir, repo);
          const stats = await fs.stat(repoDir);
          
          if (stats.mtime.getTime() < cutoffTime) {
            this.logger.debug('Removing old repository', {
              repository: `${owner}/${repo}`,
              age: `${Math.round((Date.now() - stats.mtime.getTime()) / (60 * 60 * 1000))} hours`,
            });
            await fs.rm(repoDir, { recursive: true, force: true });
          }
        }

        // Remove empty owner directories
        const remainingRepos = await fs.readdir(ownerDir);
        if (remainingRepos.length === 0) {
          await fs.rmdir(ownerDir);
        }
      }
    } catch (error) {
      this.logger.error('Failed to cleanup old repositories', error);
    }
  }

  /**
   * Check if repository exists locally
   */
  private async repositoryExists(localPath: string): Promise<boolean> {
    try {
      await fs.access(path.join(localPath, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clone repository from GitHub
   */
  private async cloneRepository(repoInfo: RepositoryInfo): Promise<void> {
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(repoInfo.localPath), { recursive: true });

    await execAsync(`git clone ${repoInfo.cloneUrl} ${repoInfo.localPath}`);
    
    this.logger.debug('Repository cloned successfully', {
      repository: repoInfo.fullName,
      localPath: repoInfo.localPath,
    });
  }

  /**
   * Update existing repository
   */
  private async updateRepository(repoInfo: RepositoryInfo): Promise<void> {
    // Fetch latest changes
    await execAsync('git fetch origin', { cwd: repoInfo.localPath });
    
    // Reset to main/master branch
    try {
      await execAsync('git checkout main', { cwd: repoInfo.localPath });
    } catch {
      await execAsync('git checkout master', { cwd: repoInfo.localPath });
    }
    
    // Pull latest changes
    await execAsync('git pull', { cwd: repoInfo.localPath });
    
    this.logger.debug('Repository updated successfully', {
      repository: repoInfo.fullName,
    });
  }

  /**
   * Parse git command output into file list
   */
  private parseFileList(gitOutput: string): string[] {
    return gitOutput
      .trim()
      .split('\n')
      .filter(file => file.length > 0);
  }
}