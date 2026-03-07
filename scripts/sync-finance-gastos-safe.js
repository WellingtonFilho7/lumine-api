#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildSteps } = require('./lib/finance-gastos-sync-runner');

const APPLY = process.argv.includes('--apply');

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function nowStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureRequiredEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SPREADSHEET_ID'];
  const missing = required.filter(key => !process.env[key]);
  const hasGoogle = Boolean(process.env.GOOGLE_CREDENTIALS) || Boolean(process.env.GOOGLE_CREDENTIALS_FILE);
  if (!hasGoogle) missing.push('GOOGLE_CREDENTIALS or GOOGLE_CREDENTIALS_FILE');

  if (missing.length) {
    fail(`Missing required env vars: ${missing.join(', ')}`);
  }
}

function run() {
  ensureRequiredEnv();

  const logsDir = path.join(process.cwd(), 'logs', 'finance-sync');
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `${nowStamp()}_${APPLY ? 'apply' : 'dry-run'}.log`);
  const stream = fs.createWriteStream(logPath, { flags: 'a' });

  const write = line => {
    process.stdout.write(`${line}\n`);
    stream.write(`${line}\n`);
  };

  write(`=== Finance sync start (${APPLY ? 'apply' : 'dry-run'}) ===`);
  write(`Log file: ${logPath}`);

  const steps = buildSteps({ apply: APPLY });
  for (const step of steps) {
    write(`\n--- step: ${step.name} ---`);
    write(`cmd: node ${step.args.join(' ')}`);

    const result = spawnSync(process.execPath, step.args, {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.stdout) stream.write(result.stdout);
    if (result.stderr) stream.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    if (result.status !== 0) {
      write(`step failed: ${step.name} (exit ${result.status ?? 1})`);
      write(`=== Finance sync aborted ===`);
      stream.end();
      process.exit(result.status ?? 1);
    }
  }

  write(`\n=== Finance sync done (${APPLY ? 'apply' : 'dry-run'}) ===`);
  stream.end();
}

run();
