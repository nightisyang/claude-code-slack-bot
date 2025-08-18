import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { ConversationSession } from './types.js';
import { Logger } from './logger.js';
import { McpManager, McpServerConfig } from './mcp-manager.js';
import { PersistenceManager, SerializedConversationSession } from './persistence-manager.js';

export class ClaudeHandler {
  private sessions: Map<string, ConversationSession> = new Map();
  private logger = new Logger('ClaudeHandler');
  private mcpManager: McpManager;
  private persistenceManager: PersistenceManager;

  constructor(mcpManager: McpManager, persistenceManager: PersistenceManager) {
    this.mcpManager = mcpManager;
    this.persistenceManager = persistenceManager;
    // RESTORED: Load persisted sessions to maintain continuity across restarts
    this.loadPersistedSessions();
    this.logger.info('🔧 ClaudeHandler initialized WITH session persistence');
  }

  private loadPersistedSessions(): void {
    // RESTORED: Load persisted sessions from disk
    const state = this.persistenceManager.loadState();
    if (state?.sessions) {
      for (const [key, session] of Object.entries(state.sessions)) {
        this.sessions.set(key, {
          ...session,
          lastActivity: new Date(session.lastActivity)
        });
      }
      this.logger.info('📂 Loaded persisted sessions', { 
        count: Object.keys(state.sessions).length 
      });
    }
  }

  getSessionKey(userId: string, channelId: string, threadTs?: string): string {
    return `${userId}-${channelId}-${threadTs || 'direct'}`;
  }

  getSession(userId: string, channelId: string, threadTs?: string): ConversationSession | undefined {
    return this.sessions.get(this.getSessionKey(userId, channelId, threadTs));
  }

  createSession(userId: string, channelId: string, threadTs?: string): ConversationSession {
    const session: ConversationSession = {
      userId,
      channelId,
      threadTs,
      isActive: true,
      lastActivity: new Date(),
    };
    const key = this.getSessionKey(userId, channelId, threadTs);
    this.sessions.set(key, session);
    this.saveSessionState(key, session);
    return session;
  }

  private saveSessionState(key: string, session: ConversationSession): void {
    // RESTORED: Save session state to persistence
    const serialized: SerializedConversationSession = {
      userId: session.userId,
      channelId: session.channelId,
      threadTs: session.threadTs,
      sessionId: session.sessionId,
      isActive: session.isActive,
      lastActivity: session.lastActivity.toISOString()
    };
    this.persistenceManager.scheduleAutoSave({
      sessions: { [key]: serialized }
    });
    this.logger.debug('💾 Session state saved to persistence', { key, sessionId: session.sessionId });
  }

  updateSessionActivity(key: string): void {
    const session = this.sessions.get(key);
    if (session) {
      session.lastActivity = new Date();
      // RESTORED: Save updated activity to persistence
      this.saveSessionState(key, session);
      this.logger.debug('⏰ Session activity updated', { key, sessionId: session.sessionId });
    }
  }

  async *streamQuery(
    prompt: string,
    session?: ConversationSession,
    abortController?: AbortController,
    workingDirectory?: string,
    slackContext?: { channel: string; threadTs?: string; user: string }
  ): AsyncGenerator<any, void, unknown> {
    this.logger.info('🚀 Starting streamQuery', {
      promptLength: prompt.length,
      hasSession: !!session,
      sessionId: session?.sessionId,
      workingDirectory,
      hasAbortController: !!abortController
    });

    // Configure model options with proper settings
    const modelOptions: any = {
      // Bypass all permission prompts to allow all tools
      permissionMode: 'bypassPermissions',
      
      // Set working directory if provided
      ...(workingDirectory && { cwd: workingDirectory }),
    };

    this.logger.info('🔧 Model options prepared', {
      ...modelOptions,
      workingDirectorySet: !!workingDirectory
    });

    // Add MCP server configuration if available
    const mcpServers = this.mcpManager.getServerConfiguration();
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      modelOptions.mcpServers = mcpServers;
      
      // Note: We don't set allowedTools for MCP since permissionMode: 'bypassPermissions' 
      // already allows all tools including MCP tools
      
      this.logger.debug('Added MCP configuration to options', {
        serverCount: Object.keys(mcpServers).length,
        servers: Object.keys(mcpServers),
        permissionMode: modelOptions.permissionMode,
      });
    }

    // RESTORED: Handle session resumption with correct community provider syntax
    let modelToUse;
    if (session?.sessionId) {
      this.logger.info('🔄 Resuming existing session', { sessionId: session.sessionId });
      modelToUse = claudeCode('sonnet', { resume: session.sessionId, ...modelOptions });
    } else {
      this.logger.info('🆕 Starting new Claude conversation');
      modelToUse = claudeCode('sonnet', modelOptions);
    }

    this.logger.info('🎯 About to call streamText...');

    // Add timeout detection for debugging
    const timeoutId = setTimeout(() => {
      this.logger.error('⏰ TIMEOUT: streamText call has been hanging for 30 seconds!');
    }, 30000);

    try {
      // Use AI SDK streamText with claude-code provider
      const result = await streamText({
        model: modelToUse,
        prompt,
        abortSignal: abortController?.signal,
      });

      clearTimeout(timeoutId); // Clear timeout since call succeeded

      this.logger.info('✅ streamText call successful, result received');
      this.logger.info('📊 Result properties:', {
        hasTextStream: !!result.textStream,
        hasProviderMetadata: !!result.providerMetadata,
        hasUsage: !!result.usage
      });

      // MOVED: Metadata extraction now happens AFTER streaming completes
      // This prevents the deadlock where metadata Promise waits for streaming to finish
      // but we're trying to extract it before streaming starts
      this.logger.info('⏭️ SKIPPING pre-streaming metadata extraction to prevent deadlock');
      /*
      const metadata = await result.providerMetadata;
      if (session && metadata?.['claude-code']?.sessionId) {
        const newSessionId = String(metadata['claude-code'].sessionId);
        
        // Only update if sessionId changed (new session) or was not set
        if (!session.sessionId || session.sessionId !== newSessionId) {
          session.sessionId = newSessionId;
          this.logger.info('🔑 Session ID captured/updated', { 
            sessionId: session.sessionId,
            model: 'sonnet',
            wasNewSession: !session.sessionId
          });
          
          // RESTORED: Save session ID to persistence for future resumption
          const sessionKey = this.getSessionKey(session.userId, session.channelId, session.threadTs);
          this.saveSessionState(sessionKey, session);
        } else {
          this.logger.debug('🔑 Session ID unchanged', { sessionId: session.sessionId });
        }
      }
      */

      this.logger.info('🔄 About to start streaming text chunks...');

      let fullResponse = '';
      let chunkCount = 0;
      let lastChunkTime = Date.now();
      const streamStartTime = Date.now();
      
      // Heartbeat timer for long-running streams - VERY VERBOSE
      const heartbeatInterval = setInterval(() => {
        const elapsed = Date.now() - streamStartTime;
        const timeSinceLastChunk = Date.now() - lastChunkTime;
        this.logger.info('💓 ❗ STREAMING HEARTBEAT ❗', {
          sessionId: session?.sessionId,
          elapsedMs: elapsed,
          elapsedSec: Math.round(elapsed / 1000),
          timeSinceLastChunkMs: timeSinceLastChunk,
          timeSinceLastChunkSec: Math.round(timeSinceLastChunk / 1000),
          chunksReceived: chunkCount,
          totalLength: fullResponse.length,
          abortSignalAborted: abortController?.signal.aborted || false,
          streamIsActive: true
        });
        
        // Extra loud if no chunks received for a while
        if (timeSinceLastChunk > 10000) {
          this.logger.warn('⚠️ 🔊 NO CHUNKS FOR 10+ SECONDS - POSSIBLE HANG');
        }
      }, 3000); // Every 3 seconds for maximum verbosity
      
      // Stream text chunks in compatible format with MAXIMUM debugging
      try {
        this.logger.info('🎯 ❗ ENTERING for await loop for textStream ❗');
        
        for await (const chunk of result.textStream) {
          const chunkReceiveTime = Date.now();
          chunkCount++;
          lastChunkTime = chunkReceiveTime;
          const chunkProcessStartTime = Date.now();
          
          fullResponse += chunk;
          
          this.logger.info(`📝 🔊 CHUNK ${chunkCount} RECEIVED 🔊`, {
            chunkLength: chunk.length,
            totalLength: fullResponse.length,
            chunkPreview: chunk.substring(0, 150) + (chunk.length > 150 ? '...' : ''),
            elapsedSinceStreamStart: chunkReceiveTime - streamStartTime,
            timeSinceLastChunk: chunkCount > 1 ? chunkReceiveTime - lastChunkTime : 0,
            abortSignalAborted: abortController?.signal.aborted || false,
            sessionId: session?.sessionId,
            chunkNumber: chunkCount
          });
          
          // Check abort signal before yielding - VERBOSE
          if (abortController?.signal.aborted) {
            this.logger.warn('🛑 ❗ ABORT SIGNAL DETECTED - breaking from chunk loop ❗');
            clearInterval(heartbeatInterval);
            break;
          }
          
          this.logger.debug(`📤 ❗ YIELDING chunk ${chunkCount} to consumer ❗`);
          
          // Yield text chunks in a format compatible with existing code
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: chunk }]
            },
            session_id: session?.sessionId
          };
          
          const chunkProcessEndTime = Date.now();
          this.logger.debug(`✅ ❗ CHUNK ${chunkCount} yielded successfully in ${chunkProcessEndTime - chunkProcessStartTime}ms ❗`);
        }
        
        clearInterval(heartbeatInterval);
        this.logger.info('🏁 ❗ EXITED for await loop - streaming iterator completed ❗');
        
        const streamEndTime = Date.now();
        this.logger.info('✅ 🔊 STREAMING COMPLETED 🔊', {
          totalChunks: chunkCount,
          totalLength: fullResponse.length,
          totalDurationMs: streamEndTime - streamStartTime,
          totalDurationSec: Math.round((streamEndTime - streamStartTime) / 1000),
          averageChunkSize: chunkCount > 0 ? Math.round(fullResponse.length / chunkCount) : 0,
          averageTimeBetweenChunks: chunkCount > 1 ? Math.round((streamEndTime - streamStartTime) / chunkCount) : 0,
          finalAbortState: abortController?.signal.aborted || false,
          sessionId: session?.sessionId
        });
      } catch (streamError) {
        clearInterval(heartbeatInterval);
        this.logger.error('❌ 🔊 ERROR DURING STREAMING 🔊', {
          error: streamError,
          errorMessage: streamError.message,
          errorName: streamError.name,
          errorStack: streamError.stack,
          chunksReceivedBeforeError: chunkCount,
          lengthReceivedBeforeError: fullResponse.length,
          elapsedBeforeError: Date.now() - streamStartTime,
          abortSignalAborted: abortController?.signal.aborted || false,
          sessionId: session?.sessionId
        });
        throw streamError;
      }

      this.logger.info('📊 Getting final metadata...');

      // Extract final metadata with timeout protection at the natural completion stage
      let finalUsage = null;
      let finalProviderMetadata = null;
      
      try {
        this.logger.info('🔍 EXTRACTING final metadata with timeout protection...');
        const finalMetadataStart = Date.now();
        
        // Extract both usage and provider metadata with timeout
        const metadataResults = await Promise.race([
          Promise.all([result.usage, result.providerMetadata]),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('10-second final metadata timeout')), 10000)
          )
        ]);
        
        const [usage, providerMetadata] = metadataResults;
        
        const finalMetadataTime = Date.now() - finalMetadataStart;
        finalUsage = usage;
        finalProviderMetadata = providerMetadata;
        
        this.logger.info('🔍 ✅ FINAL METADATA RESOLVED!', {
          extractionTimeMs: finalMetadataTime,
          hasUsage: !!usage,
          hasProviderMetadata: !!providerMetadata,
          usageKeys: usage ? Object.keys(usage) : [],
          providerMetadataKeys: providerMetadata ? Object.keys(providerMetadata) : [],
          hasClaudeCode: !!providerMetadata?.['claude-code'],
          sessionId: providerMetadata?.['claude-code']?.sessionId,
          costUsd: providerMetadata?.['claude-code']?.costUsd,
          durationMs: providerMetadata?.['claude-code']?.durationMs
        });

        // Update session with captured session ID for NEXT conversation
        if (session && providerMetadata?.['claude-code']?.sessionId) {
          const newSessionId = String(providerMetadata['claude-code'].sessionId);
          
          if (!session.sessionId || session.sessionId !== newSessionId) {
            session.sessionId = newSessionId;
            this.logger.info('🔑 Session ID captured for NEXT conversation!', { 
              sessionId: session.sessionId,
              model: 'sonnet',
              wasNewSession: !session.sessionId
            });
            
            // Save session ID to persistence for future resumption
            const sessionKey = this.getSessionKey(session.userId, session.channelId, session.threadTs);
            this.saveSessionState(sessionKey, session);
          } else {
            this.logger.debug('🔑 Session ID unchanged', { sessionId: session.sessionId });
          }
        } else {
          this.logger.warn('🔍 No session ID found in final metadata', {
            hasSession: !!session,
            hasProviderMetadata: !!providerMetadata,
            hasClaudeCodeSection: !!providerMetadata?.['claude-code']
          });
        }
        
      } catch (finalMetadataError) {
        this.logger.warn('🔍 ⏰ FINAL METADATA EXTRACTION TIMED OUT', {
          error: finalMetadataError.message,
          sessionId: session?.sessionId,
          continueWithNullMetadata: true
        });
        // Continue with null values - graceful degradation
      }

      // Yield completion result with real metadata (or null if timed out)
      yield {
        type: 'result',
        subtype: 'success',
        session_id: session?.sessionId,
        result: fullResponse,
        usage: finalUsage,
        total_cost_usd: finalProviderMetadata?.['claude-code']?.costUsd || 0,
        duration_ms: finalProviderMetadata?.['claude-code']?.durationMs || 0
      };

      this.logger.info('🎉 streamQuery completed successfully');
    } catch (error) {
      this.logger.error('Error in Claude query', error);
      throw error;
    }
  }

  cleanupInactiveSessions(maxAge: number = 30 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > maxAge) {
        this.sessions.delete(key);
        this.persistenceManager.removeSession(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} inactive sessions`);
      // Also clean up in persistence
      this.persistenceManager.cleanupOldSessions(maxAge);
    }
  }
}