// Ensure node is findable by Turbopack child processes
const path = require('path');
const os = require('os');
process.env.PATH = path.join(os.homedir(), 'bin') + ':/opt/homebrew/bin:' + (process.env.PATH || '/usr/bin:/bin');
require('next/dist/bin/next');
