module.exports = {
  apps: [{
    name: 'E6ai',
    script: 'index.js',
    cwd: '/home/kebolder/discord/e6aibot',
    watch: true,
    ignore_watch: ["data", ".pm2/logs"],
    env: {
      NODE_ENV: 'production'
    }
  }]
}; 