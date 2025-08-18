# Claude Code Slack Bot

This is a TypeScript-based Slack bot that integrates with the Claude Code AI SDK to provide AI-powered coding assistance directly within Slack workspaces. The bot now features comprehensive persistence, health monitoring, and production-ready deployment capabilities.

## Project Overview

The bot allows users to interact with Claude Code through Slack, providing real-time coding assistance, file analysis, code reviews, and project management capabilities. It supports both direct messages and channel conversations, with sophisticated working directory management, task tracking, persistent sessions, and health monitoring.

## Architecture

### Core Components

- **`src/index.ts`** - Application entry point and initialization
- **`src/config.ts`** - Environment configuration and validation
- **`src/slack-handler.ts`** - Main Slack event handling and message processing
- **`src/claude-handler.ts`** - Claude Code AI SDK integration with persistence and session management
- **`src/working-directory-manager.ts`** - Working directory configuration and resolution
- **`src/file-handler.ts`** - File upload processing and content embedding
- **`src/todo-manager.ts`** - Task list management and progress tracking
- **`src/mcp-manager.ts`** - MCP server configuration and management
- **`src/persistence-manager.ts`** - State persistence and backup management
- **`src/health-server.ts`** - Health monitoring and status endpoints
- **`src/logger.ts`** - Structured logging utility
- **`src/types.ts`** - TypeScript type definitions

### Key Features

#### 1. Working Directory Management
- **Base Directory Support**: Configure a base directory (e.g., `/Users/username/Code/`) to use short project names
- **Channel Defaults**: Each channel gets a default working directory when the bot is first added
- **Thread Overrides**: Individual threads can override the channel default by mentioning the bot
- **Hierarchy**: Thread-specific > Channel default > DM-specific
- **Smart Resolution**: Supports both relative paths (`cwd project-name`) and absolute paths

#### 2. Real-Time Task Tracking
- **Todo Lists**: Displays Claude's planning process as formatted task lists in Slack
- **Progress Updates**: Updates task status in real-time as Claude works
- **Priority Indicators**: Visual priority levels (🔴 High, 🟡 Medium, 🟢 Low)
- **Status Reactions**: Emoji reactions on original messages show overall progress
- **Live Updates**: Single message updates instead of spam

#### 3. File Upload Support
- **Multiple Formats**: Images (JPG, PNG, GIF, WebP), text files, code files, documents
- **Content Embedding**: Text files are embedded directly in prompts
- **Image Analysis**: Images are saved for Claude to analyze using the Read tool
- **Size Limits**: 50MB file size limit with automatic cleanup
- **Security**: Secure download using Slack bot token authentication

#### 4. Advanced Message Handling
- **Streaming Responses**: Real-time message updates as Claude generates responses
- **Tool Formatting**: Rich formatting for file edits, bash commands, and other tool usage
- **Status Indicators**: Clear visual feedback (🤔 Thinking, ⚙️ Working, ✅ Completed)
- **Error Handling**: Graceful error recovery with informative messages
- **Session Management**: Conversation context maintained across interactions

#### 5. Channel Integration
- **Auto-Setup**: Automatic welcome message when added to channels
- **Mentions**: Responds to @mentions in channels
- **Thread Support**: Maintains context within threaded conversations
- **File Uploads**: Handles file uploads in any conversation context

#### 6. Session Persistence & Recovery
- **Persistent Sessions**: Conversations survive bot restarts and server reboots
- **Automatic State Saving**: Debounced writes to disk with backup system
- **Session Resumption**: Seamless continuation of conversations after interruptions
- **Data Integrity**: Backup files and error recovery for state corruption
- **Memory Management**: Efficient session cleanup and garbage collection

#### 7. Health Monitoring & Production Features
- **Health Endpoints**: HTTP monitoring endpoints for uptime tracking
- **Process Management**: Custom process management with PID tracking and automatic restarts
- **Startup Scripts**: Automated deployment with health checks and cron job scheduling
- **Status Monitoring**: Real-time bot status and metric tracking
- **Graceful Shutdown**: Clean termination with state preservation

#### 8. MCP (Model Context Protocol) Integration
- **External Tools**: Extends Claude's capabilities with external MCP servers
- **Multiple Server Types**: Supports stdio, SSE, and HTTP MCP servers
- **Auto-Configuration**: Loads servers from `mcp-servers.json` automatically
- **Tool Management**: All MCP tools are allowed by default with `mcp__serverName__toolName` pattern
- **Runtime Management**: Reload configuration without restarting the bot
- **Popular Integrations**: Filesystem access, GitHub API, database connections, web search

## Environment Configuration

### Required Variables
```env
# Slack App Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token  
SLACK_SIGNING_SECRET=your-signing-secret

# Claude Code Configuration  
# Authentication handled via 'claude setup-token' - no API key needed
```

### Optional Variables
```env
# Working Directory Configuration
BASE_DIRECTORY=/Users/username/Code/

# Health Server Configuration
HEALTH_PORT=3001

# Third-party API Providers
CLAUDE_CODE_USE_BEDROCK=1
CLAUDE_CODE_USE_VERTEX=1

# Development
DEBUG=true
```

## Slack App Configuration

### Required Permissions
- `app_mentions:read` - Read mentions
- `channels:history` - Read channel messages
- `chat:write` - Send messages
- `chat:write.public` - Write to public channels
- `im:history` - Read direct messages
- `im:read` - Basic DM info
- `im:write` - Send direct messages
- `users:read` - Read user information
- `reactions:read` - Read message reactions
- `reactions:write` - Add/remove reactions

### Required Events
- `app_mention` - When the bot is mentioned
- `message.im` - Direct messages
- `member_joined_channel` - When bot is added to channels

### Socket Mode
The bot uses Socket Mode for real-time event handling, requiring an app-level token with `connections:write` scope.

## Usage Patterns

### Channel Setup
```
1. Add bot to channel
2. Bot sends welcome message asking for working directory
3. Set default: `cwd project-name` or `cwd /absolute/path`
4. Start using: `@ClaudeBot help me with authentication`
```

### Thread Overrides
```
@ClaudeBot cwd different-project
@ClaudeBot now help me with this other codebase
```

### File Analysis
```
[Upload image/code file]
Analyze this screenshot and suggest improvements
```

### Task Tracking
Users see real-time task lists as Claude plans and executes work:
```
📋 Task List

🔄 In Progress:
🔴 Analyze authentication system

⏳ Pending:  
🟡 Implement OAuth flow
🟢 Add error handling

Progress: 1/3 tasks completed (33%)
```

### MCP Server Management
```
# View configured MCP servers
User: mcp
Bot: 🔧 MCP Servers Configured:
     • filesystem (stdio)
     • github (stdio)  
     • postgres (stdio)

# Reload MCP configuration
User: mcp reload
Bot: ✅ MCP configuration reloaded successfully.

# Use MCP tools automatically
User: @ClaudeBot list all TODO comments in the project
Bot: [Uses mcp__filesystem tools to search files]
```

## Development

### Authentication Setup
```bash
# First, authenticate with Claude Code (one-time setup)
claude setup-token

# This replaces the need for ANTHROPIC_API_KEY in environment variables
```

### Build and Run
```bash
npm install
npm run build

# Development
npm run dev           # Development with hot reload

# Production
npm run start         # Production with custom process management
npm run prod          # Direct production mode
npm run restart       # Restart with health checks
npm run stop          # Graceful shutdown
npm run status        # Check bot health status
```

### Project Structure
```
src/
├── index.ts                      # Entry point
├── config.ts                     # Configuration
├── slack-handler.ts              # Slack event handling
├── claude-handler.ts             # AI SDK integration with persistence
├── working-directory-manager.ts  # Directory management
├── file-handler.ts               # File processing
├── todo-manager.ts               # Task tracking
├── mcp-manager.ts                # MCP server management
├── persistence-manager.ts        # State persistence & backups
├── health-server.ts              # Health monitoring endpoints
├── logger.ts                     # Logging utility
└── types.ts                      # Type definitions

# Production & Configuration
scripts/
├── startup.sh                    # Production startup script
├── shutdown.sh                   # Graceful shutdown script
└── health-check.sh               # Health monitoring script

ecosystem.config.js               # Process configuration (not PM2)
mcp-servers.json                  # MCP server configuration
mcp-servers.example.json          # Example MCP configuration

# Runtime files (created automatically)
bot-state.json                    # Persistent state storage
bot-state.json.backup            # Backup state file
.bot.pid                         # Process ID tracking
```

### Key Design Decisions

1. **Append-Only Messages**: Instead of editing a single message, each response is a separate message for better conversation flow
2. **AI SDK Integration**: Uses modern AI SDK with claude-code provider instead of legacy Claude Code SDK
3. **Persistent Session Context**: Each conversation maintains its own session that survives restarts
4. **Smart File Handling**: Text content embedded in prompts, images passed as file paths for Claude to read
5. **Hierarchical Working Directories**: Channel defaults with thread overrides for flexibility
6. **Real-Time Feedback**: Status reactions and live task updates for transparency
7. **Production-Ready Architecture**: Health monitoring, process management, and automated deployment

### Error Handling & Monitoring
- Graceful degradation when Slack API calls fail
- Automatic retry for transient errors
- Comprehensive logging with structured output
- User-friendly error messages with recovery suggestions
- Automatic cleanup of temporary files
- Health endpoint monitoring for uptime tracking
- Process crash recovery with custom health monitoring and cron jobs
- State corruption detection and backup restoration

### Security Considerations
- Token-based authentication via `claude setup-token`
- Environment variables for sensitive Slack configuration
- Secure file download with proper authentication
- Temporary file cleanup after processing
- Persistent state stored locally (not in external databases)
- Validation of file types and sizes
- Process isolation and permission management

## Production Deployment

### Health Monitoring
```bash
# Check bot status
curl http://localhost:3001/status

# View detailed health information
curl http://localhost:3001/health

# Monitor process with custom scripts
./scripts/health-check.sh
tail -f logs/bot.log
curl http://localhost:3001/health
```

### Process Management
```bash
# Start in production mode
npm run start

# Stop gracefully
npm run stop

# Restart with health checks
npm run restart

# Remove from startup (stops auto-restart)
npm run stop:all
```

## Future Enhancements

### Completed Features ✅
- ✅ Persistent working directory storage
- ✅ Session persistence across restarts
- ✅ Health monitoring and process management
- ✅ Production deployment automation
- ✅ Comprehensive error handling and recovery

### Potential Future Expansions
- Advanced file format support (PDFs, Office docs)
- Integration with version control systems (GitHub, GitLab)
- Custom slash commands for Slack
- Team-specific bot configurations and permissions
- Analytics and usage tracking dashboard
- Multi-workspace support with isolated configurations
- Database-backed persistence for enterprise deployments
- Optional PM2 integration for enterprise deployments (currently uses custom process management)