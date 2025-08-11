import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

const logger = new Logger('PermissionIPC');

interface IPCApproval {
  approvalId: string;
  approved: boolean;
  timestamp: number;
}

export class PermissionIPC {
  private ipcFilePath: string;

  constructor() {
    // Use a fixed path that both processes can access
    this.ipcFilePath = path.join(__dirname, '..', '.permission-approvals.json');
    logger.info('PermissionIPC initialized', { 
      ipcFilePath: this.ipcFilePath,
      dirname: __dirname 
    });
  }

  private readIPCFile(): Record<string, IPCApproval> {
    try {
      logger.debug('Main process reading IPC file', { 
        ipcFilePath: this.ipcFilePath, 
        exists: fs.existsSync(this.ipcFilePath) 
      });
      
      if (fs.existsSync(this.ipcFilePath)) {
        const data = fs.readFileSync(this.ipcFilePath, 'utf-8');
        const approvals = JSON.parse(data);
        logger.debug('Main process read IPC file successfully', { 
          approvalCount: Object.keys(approvals).length 
        });
        return approvals;
      }
    } catch (error: any) {
      logger.warn('Main process error reading IPC file', { error: error.message });
    }
    return {};
  }

  private writeIPCFile(approvals: Record<string, IPCApproval>) {
    try {
      logger.debug('Main process writing IPC file', { 
        ipcFilePath: this.ipcFilePath, 
        approvalCount: Object.keys(approvals).length 
      });
      fs.writeFileSync(this.ipcFilePath, JSON.stringify(approvals, null, 2));
      logger.debug('Main process wrote IPC file successfully');
    } catch (error: any) {
      logger.error('Main process error writing IPC file', { error: error.message });
    }
  }

  public writeApproval(approvalId: string, approved: boolean): void {
    const approvals = this.readIPCFile();
    approvals[approvalId] = {
      approvalId,
      approved,
      timestamp: Date.now()
    };
    
    this.writeIPCFile(approvals);
    logger.info('Wrote approval to IPC file', { approvalId, approved, ipcFilePath: this.ipcFilePath });
  }

  public cleanupOldApprovals(): void {
    const approvals = this.readIPCFile();
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    
    let cleaned = false;
    for (const [id, approval] of Object.entries(approvals)) {
      if (now - approval.timestamp > maxAge) {
        delete approvals[id];
        cleaned = true;
      }
    }
    
    if (cleaned) {
      this.writeIPCFile(approvals);
      logger.info('Cleaned up old approvals from IPC file');
    }
  }

  public cleanupIPCFile(): void {
    try {
      if (fs.existsSync(this.ipcFilePath)) {
        fs.unlinkSync(this.ipcFilePath);
        logger.info('Cleaned up IPC file on startup');
      }
    } catch (error) {
      logger.warn('Could not clean up IPC file', error);
    }
  }
}