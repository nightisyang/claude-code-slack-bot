module.exports = {
  apps: [{
    name: 'claude-bot',
    script: './node_modules/.bin/tsx',
    args: 'src/index.ts',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    
    // Health check configuration
    min_uptime: '10s',
    max_restarts: 5,
    
    // HTTP health check
    http_health_check: {
      interval: 30000, // 30 seconds
      url: 'http://localhost:3001/health',
      max_consecutive_failures: 3
    }
  }]
};

// Usage:
// npm install -g pm2
// pm2 start ecosystem.config.js
// pm2 save
// pm2 startup  # To start on system boot