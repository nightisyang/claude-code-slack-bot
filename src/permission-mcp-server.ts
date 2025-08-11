#!/usr/bin/env node

// IMMEDIATE DEBUG LOGGING - SHOULD ALWAYS SHOW
console.error('=== MCP SERVER FILE LOADING ===');
console.error(`Process ID: ${process.pid}`);
console.error(`Working Directory: ${process.cwd()}`);
console.error(`Node Version: ${process.version}`);
console.error(`Arguments: ${JSON.stringify(process.argv)}`);
console.error(`Environment: SLACK_BOT_TOKEN=${!!process.env.SLACK_BOT_TOKEN}, SLACK_CONTEXT=${!!process.env.SLACK_CONTEXT}`);
console.error(`Parent PID: ${process.ppid || 'unknown'}`);
console.error(`Stdio is TTY: stdin=${process.stdin.isTTY}, stdout=${process.stdout.isTTY}, stderr=${process.stderr.isTTY}`);

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebClient } from '@slack/web-api';
import { Logger } from './logger.js';
import * as fs from 'fs';
import * as path from 'path';

console.error('=== MCP SERVER IMPORTS COMPLETED ===');

const logger = new Logger('PermissionMCP');

interface PermissionRequest {
  tool_name: string;
  input: any;
  channel?: string;
  thread_ts?: string;
  user?: string;
}

interface PermissionResponse {
  behavior: 'allow' | 'deny';
  updatedInput?: any;
  message?: string;
}

interface IPCApproval {
  approvalId: string;
  approved: boolean;
  timestamp: number;
}

class PermissionMCPServer {
  private server: Server;
  private slack: WebClient;
  private pendingApprovals = new Map<string, {
    resolve: (response: PermissionResponse) => void;
    reject: (error: Error) => void;
  }>();
  private ipcFilePath: string;

  constructor() {
    // Force logging to stderr so we can see it
    console.error('[MCP-DEBUG] PermissionMCPServer constructor called', {
      workingDir: process.cwd(),
      dirname: __dirname,
      processId: process.pid,
      isMain: require.main === module
    });
    
    logger.info('PermissionMCPServer constructor called', {
      workingDir: process.cwd(),
      dirname: __dirname,
      processId: process.pid,
      isMain: require.main === module
    });
    this.server = new Server(
      {
        name: "permission-prompt",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.slack = new WebClient(process.env.SLACK_BOT_TOKEN);
    // Use a fixed path that both processes can access
    this.ipcFilePath = path.join(__dirname, '..', '.permission-approvals.json');
    this.setupHandlers();
    this.cleanupIPCFile();
  }

  private cleanupIPCFile() {
    try {
      logger.info('MCP server using IPC file path', { ipcFilePath: this.ipcFilePath });
      if (fs.existsSync(this.ipcFilePath)) {
        fs.unlinkSync(this.ipcFilePath);
        logger.debug('Cleaned up existing IPC file');
      }
    } catch (error) {
      logger.warn('Could not clean up IPC file on startup', error);
    }
  }

  private readIPCFile(): Record<string, IPCApproval> {
    try {
      logger.debug('Attempting to read IPC file', { 
        ipcFilePath: this.ipcFilePath, 
        exists: fs.existsSync(this.ipcFilePath) 
      });
      
      if (fs.existsSync(this.ipcFilePath)) {
        const data = fs.readFileSync(this.ipcFilePath, 'utf-8');
        const approvals = JSON.parse(data);
        logger.debug('Successfully read IPC file', { 
          approvalCount: Object.keys(approvals).length,
          approvalIds: Object.keys(approvals)
        });
        return approvals;
      } else {
        logger.debug('IPC file does not exist');
      }
    } catch (error: any) {
      logger.warn('Error reading IPC file', { error: error.message, ipcFilePath: this.ipcFilePath });
    }
    return {};
  }

  private removeFromIPCFile(approvalId: string) {
    try {
      const approvals = this.readIPCFile();
      if (approvals[approvalId]) {
        delete approvals[approvalId];
        fs.writeFileSync(this.ipcFilePath, JSON.stringify(approvals, null, 2));
        logger.debug('Removed approval from IPC file', { approvalId });
      }
    } catch (error) {
      logger.error('Error removing approval from IPC file', error);
    }
  }

  private checkForApproval(approvalId: string): boolean {
    logger.debug('Checking for approval', { 
      approvalId, 
      pendingCount: this.pendingApprovals.size,
      pendingIds: Array.from(this.pendingApprovals.keys())
    });
    
    const approvals = this.readIPCFile();
    const approval = approvals[approvalId];
    
    logger.debug('Approval check result', { 
      approvalId, 
      found: !!approval,
      approved: approval?.approved,
      timestamp: approval?.timestamp
    });
    
    if (approval) {
      const pending = this.pendingApprovals.get(approvalId);
      if (pending) {
        console.error(`[MCP-DEBUG] RESOLVING APPROVAL: ${approvalId} with ${approval.approved ? 'ALLOW' : 'DENY'}`);
        this.pendingApprovals.delete(approvalId);
        pending.resolve({
          behavior: approval.approved ? 'allow' : 'deny',
          message: approval.approved ? 'Approved by user' : 'Denied by user'
        });
        
        // Clean up the IPC file entry
        this.removeFromIPCFile(approvalId);
        
        logger.info('Successfully resolved approval from IPC', { approvalId, approved: approval.approved });
        console.error(`[MCP-DEBUG] APPROVAL RESOLVED SUCCESSFULLY: ${approvalId}`);
        return true;
      } else {
        console.error(`[MCP-DEBUG] APPROVAL FOUND BUT NO PENDING RESOLVER: ${approvalId}, pending count: ${this.pendingApprovals.size}`);
        logger.warn('Approval found but no pending resolver', { 
          approvalId, 
          pendingCount: this.pendingApprovals.size,
          allPendingIds: Array.from(this.pendingApprovals.keys())
        });
      }
    }
    
    return false;
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "permission_prompt",
            description: "Request user permission for tool execution via Slack button",
            inputSchema: {
              type: "object",
              properties: {
                tool_name: {
                  type: "string",
                  description: "Name of the tool requesting permission",
                },
                input: {
                  type: "object",
                  description: "Input parameters for the tool",
                },
                channel: {
                  type: "string",
                  description: "Slack channel ID",
                },
                thread_ts: {
                  type: "string",
                  description: "Slack thread timestamp",
                },
                user: {
                  type: "string",
                  description: "User ID requesting permission",
                },
              },
              required: ["tool_name", "input"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "permission_prompt") {
        return await this.handlePermissionPrompt(request.params.arguments as unknown as PermissionRequest);
      }
      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  private async handlePermissionPrompt(params: PermissionRequest) {
    const { tool_name, input } = params;
    
    // Get Slack context from environment (passed by Claude handler)
    const slackContextStr = process.env.SLACK_CONTEXT;
    const slackContext = slackContextStr ? JSON.parse(slackContextStr) : {};
    const { channel, threadTs: thread_ts, user } = slackContext;
    
    // Generate unique approval ID
    const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create approval message with buttons
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🔐 *Permission Request*\n\nClaude wants to use the tool: \`${tool_name}\`\n\n*Tool Parameters:*\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "✅ Approve"
            },
            style: "primary",
            action_id: "approve_tool",
            value: approvalId
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "❌ Deny"
            },
            style: "danger",
            action_id: "deny_tool",
            value: approvalId
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Requested by: <@${user}> | Tool: ${tool_name}`
          }
        ]
      }
    ];

    try {
      // Send approval request to Slack
      const result = await this.slack.chat.postMessage({
        channel: channel || user || 'general',
        thread_ts: thread_ts,
        blocks,
        text: `Permission request for ${tool_name}` // Fallback text
      });

      // Wait for user response
      const response = await this.waitForApproval(approvalId);
      
      // Update the message to show the result
      if (result.ts) {
        await this.slack.chat.update({
          channel: result.channel!,
          ts: result.ts,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `🔐 *Permission Request* - ${response.behavior === 'allow' ? '✅ Approved' : '❌ Denied'}\n\nTool: \`${tool_name}\`\n\n*Tool Parameters:*\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``
              }
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `${response.behavior === 'allow' ? 'Approved' : 'Denied'} by user | Tool: ${tool_name}`
                }
              ]
            }
          ],
          text: `Permission ${response.behavior === 'allow' ? 'approved' : 'denied'} for ${tool_name}`
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response)
          }
        ]
      };
    } catch (error) {
      logger.error('Error handling permission prompt:', error);
      
      // Default to deny if there's an error
      const response: PermissionResponse = {
        behavior: 'deny',
        message: 'Error occurred while requesting permission'
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response)
          }
        ]
      };
    }
  }

  private async waitForApproval(approvalId: string): Promise<PermissionResponse> {
    return new Promise((resolve, reject) => {
      // Store the promise resolvers
      this.pendingApprovals.set(approvalId, { resolve, reject });
      
      console.error(`[MCP-DEBUG] WAITING FOR APPROVAL: ${approvalId}, pending count: ${this.pendingApprovals.size}`);
      logger.info('Started waiting for approval', { 
        approvalId, 
        pendingCount: this.pendingApprovals.size,
        ipcFilePath: this.ipcFilePath 
      });
      
      // Start polling for approval
      const pollInterval = setInterval(() => {
        if (this.checkForApproval(approvalId)) {
          clearInterval(pollInterval);
        }
      }, 500); // Check every 500ms
      
      // Set timeout (5 minutes)
      setTimeout(() => {
        if (this.pendingApprovals.has(approvalId)) {
          clearInterval(pollInterval);
          this.pendingApprovals.delete(approvalId);
          console.error(`[MCP-DEBUG] APPROVAL TIMED OUT: ${approvalId}`);
          logger.warn('Approval request timed out', { approvalId });
          resolve({
            behavior: 'deny',
            message: 'Permission request timed out'
          });
        }
      }, 5 * 60 * 1000);
    });
  }

  // Method to be called by Slack handler when button is clicked
  public resolveApproval(approvalId: string, approved: boolean, updatedInput?: any) {
    const pending = this.pendingApprovals.get(approvalId);
    if (pending) {
      this.pendingApprovals.delete(approvalId);
      pending.resolve({
        behavior: approved ? 'allow' : 'deny',
        updatedInput: updatedInput || undefined,
        message: approved ? 'Approved by user' : 'Denied by user'
      });
    }
  }

  async run() {
    try {
      console.error('[MCP-DEBUG] Starting MCP server connection...');
      const transport = new StdioServerTransport();
      console.error('[MCP-DEBUG] Created StdioServerTransport');
      await this.server.connect(transport);
      console.error('[MCP-DEBUG] MCP server connected successfully');
      logger.info('Permission MCP server started');
    } catch (error) {
      console.error('[MCP-DEBUG] Error starting MCP server:', error);
      logger.error('Failed to start Permission MCP server', error);
      throw error;
    }
  }
}

// Export singleton instance for use by Slack handler
export const permissionServer = new PermissionMCPServer();

// Run if this file is executed directly
if (require.main === module) {
  permissionServer.run().catch((error) => {
    logger.error('Permission MCP server error:', error);
    process.exit(1);
  });
}