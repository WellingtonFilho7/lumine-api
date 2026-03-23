const {
  getDefaultOpsEnvPath,
  loadOpsEnvFile,
  resolveOpsBackupOptions,
} = require('./lib/ops-backup-config');

function parseArgs(argv) {
  const args = {
    stdout: false,
    out: '',
    config: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--stdout') {
      args.stdout = true;
      continue;
    }
    if (token === '--out') {
      args.out = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--config') {
      args.config = argv[index + 1] || '';
      index += 1;
    }
  }

  return args;
}

function hydrateProcessEnv(envValues) {
  Object.entries(envValues).forEach(([key, value]) => {
    if ((process.env[key] || '') === '' && value) {
      process.env[key] = value;
    }
  });
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  const configPath = cliArgs.config || getDefaultOpsEnvPath();
  const fileEnv = loadOpsEnvFile(configPath);
  const mergedEnv = { ...fileEnv, ...process.env };
  const options = resolveOpsBackupOptions({ cliArgs, env: mergedEnv });

  hydrateProcessEnv({
    SUPABASE_URL: mergedEnv.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: mergedEnv.SUPABASE_SERVICE_ROLE_KEY,
  });

  const {
    buildOperationalBackupFilePath,
    createOperationalBackupDocument,
    writeOperationalBackupDocument,
  } = require('./lib/operational-backup');

  const document = await createOperationalBackupDocument({ generatedAt: options.generatedAt });

  if (options.stdout) {
    process.stdout.write(document.json);
    return;
  }

  const outputPath =
    options.out || buildOperationalBackupFilePath({ generatedAt: document.generatedAt });

  writeOperationalBackupDocument({ document, outputPath });

  process.stdout.write(
    `${JSON.stringify(
      {
        success: true,
        outputPath,
        generatedAt: document.generatedAt,
        dataRev: document.payload.dataRev,
        counts: document.payload.counts,
        configPathUsed: configPath,
      },
      null,
      2
    )}\n`
  );
}

main().catch(error => {
  process.stderr.write(`${error?.message || String(error)}\n`);
  process.exit(1);
});
