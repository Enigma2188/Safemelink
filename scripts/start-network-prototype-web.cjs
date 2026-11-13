'use strict';
// Local development only. Uses the parent's locked dependencies; never npm-install here.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const workspace = path.resolve(__dirname, '..');
const project = path.join(workspace, 'prototype-web');
const cli = path.join(workspace, 'node_modules', 'expo', 'bin', 'cli');
if (!fs.existsSync(cli)) {
  console.error('Dipendenze locali incomplete. Completare npm ci nel worktree NETWORK; nessuna installazione automatica.');
  process.exit(1);
}
const temp = path.join(project, '.expo', 'tmp');
fs.mkdirSync(temp, { recursive: true });
console.log('Anteprima locale: http://localhost:8095/network-prototype — Ctrl+C per terminare.');
const child = spawn(process.execPath, [cli, 'start', '--web', '--localhost', '--port', '8095'], {
  cwd: project, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, CI: '1', BROWSER: 'none', EXPO_OFFLINE: '1', EXPO_NO_DOTENV: '1',
    EXPO_NO_TELEMETRY: '1', TMP: temp, TEMP: temp, TMPDIR: temp },
});
child.on('error', () => { console.error('Avvio Expo non riuscito.'); process.exitCode = 1; });
let stopping = false;
child.on('exit', code => { process.exitCode = stopping ? 0 : (code ?? 1); });
process.on('SIGINT', () => { stopping = true; child.kill('SIGINT'); });
process.on('SIGTERM', () => { stopping = true; child.kill('SIGTERM'); });
