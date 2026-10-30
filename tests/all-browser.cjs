const { execFileSync } = require('node:child_process'),
  path = require('node:path');
for (const file of ['browser.cjs', 'family-browser.cjs', 'device-browser.cjs', 'native-ui-browser.cjs', 'guide-browser.cjs'])
  execFileSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit',
    env: process.env
  });
