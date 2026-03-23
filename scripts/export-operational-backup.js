const {
  buildOperationalBackupFilePath,
  createOperationalBackupDocument,
  writeOperationalBackupDocument,
} = require('./lib/operational-backup');

function parseArgs(argv) {
  const args = { stdout: false, out: '' };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--stdout') {
      args.stdout = true;
      continue;
    }
    if (token === '--out') {
      args.out = argv[index + 1] || '';
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const document = await createOperationalBackupDocument();

  if (args.stdout) {
    process.stdout.write(document.json);
    return;
  }

  const outputPath = args.out || buildOperationalBackupFilePath({ generatedAt: document.generatedAt });
  writeOperationalBackupDocument({ document, outputPath });

  process.stdout.write(
    `${JSON.stringify(
      {
        success: true,
        outputPath,
        generatedAt: document.generatedAt,
        dataRev: document.payload.dataRev,
        counts: document.payload.counts,
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
