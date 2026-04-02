module.exports = {
  apps: [
    {
      name: 'code-buddy-lan',
      script: 'dist/lan-server.js',
      env: {
        HOST: '0.0.0.0',
        PORT: '4432',
        NAME: 'Code Buddy LAN',
      },
    },
  ],
}

