#!/usr/bin/env node

/**
 * Ingest instructor-provided course materials into the global RAG collection.
 *
 * This is intentionally separate from /api/documents/upload. Files handled by
 * this script become course-wide documents (user_id = NULL), while files sent
 * through the API remain associated with the uploading student.
 *
 * Usage:
 *   node course-material-ingestion.js ./course-materials
 *   node course-material-ingestion.js ./course-materials --dry-run
 *   node course-material-ingestion.js ./course-materials --replace
 *
 * Supported formats are the same formats supported by rag.extractText():
 * .txt, .md, .markdown, .json, .csv, and text-based .pdf files.
 */

const fs = require('fs');
const path = require('path');
const rag = require('./rag');

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.pdf']);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);

function printUsage() {
  console.log(`Usage: node course-material-ingestion.js <directory> [options]

Options:
  --dry-run   Extract and report files without writing to SQLite
  --replace   Replace an existing global document with the same name
  --help      Show this help message

Examples:
  node course-material-ingestion.js ./course-materials
  node course-material-ingestion.js ./course-materials --dry-run
  node course-material-ingestion.js ./course-materials --replace`);
}

function parseArguments(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const directory = args.find(arg => !arg.startsWith('--'));
  if (!directory) {
    printUsage();
    process.exit(1);
  }

  return {
    directory: path.resolve(directory),
    dryRun: args.includes('--dry-run'),
    replace: args.includes('--replace')
  };
}

function loadLocalEnv() {
  // db.js reads DATABASE_PATH directly from process.env. Loading the local
  // .env here keeps this script usable without requiring a dotenv dependency.
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function collectFiles(directory) {
  const files = [];

  function visit(currentDirectory) {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

      const fullPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extension)) files.push(fullPath);
    }
  }

  visit(directory);
  return files.sort((a, b) => a.localeCompare(b));
}

function documentName(filePath, rootDirectory) {
  const relativePath = path.relative(rootDirectory, filePath).replace(/\\/g, '/');
  return relativePath.replace(/\.[^.]+$/, '');
}

function ingest(options) {
  if (!fs.existsSync(options.directory) || !fs.statSync(options.directory).isDirectory()) {
    throw new Error(`Material directory does not exist: ${options.directory}`);
  }

  const files = collectFiles(options.directory);
  if (files.length === 0) {
    console.log(`No supported files found in ${options.directory}`);
    return { processed: 0, skipped: 0, failed: 0 };
  }

  // Require the database only after validating the input directory. Loading
  // db.js initializes the schema and exposes the same ingestion path used by
  // the application, so chunking behavior cannot drift between code paths.
  const db = options.dryRun ? null : require('./db');
  const existingDocuments = db ? db.getGlobalDocuments() : [];
  const existingByName = new Map(existingDocuments.map(document => [document.name, document]));
  const summary = { processed: 0, skipped: 0, failed: 0 };

  for (const filePath of files) {
    const name = documentName(filePath, options.directory);
    process.stdout.write(`Processing ${path.relative(options.directory, filePath)} ... `);

    try {
      const extractedText = rag.extractText(fs.readFileSync(filePath), path.basename(filePath));
      if (extractedText.length < 15) {
        console.log('skipped (not enough readable text)');
        summary.skipped++;
        continue;
      }

      const existing = existingByName.get(name);
      if (existing && !options.replace) {
        console.log('skipped (already ingested; use --replace to refresh)');
        summary.skipped++;
        continue;
      }

      const chunks = rag.chunkText(extractedText);
      if (options.dryRun) {
        console.log(`ready (${extractedText.length} characters, ${chunks.length} chunks)`);
        summary.processed++;
        continue;
      }

      if (existing) db.deleteDocument(existing.id, null);

      // userId is deliberately null: these are instructor/course materials,
      // not private files uploaded by an individual student.
      const document = db.createDocument({
        userId: null,
        name,
        content: extractedText,
        status: 'Ready'
      });

      existingByName.set(name, document);
      console.log(`ingested (${document.chunks} chunks)`);
      summary.processed++;
    } catch (error) {
      console.log(`failed (${error.message})`);
      summary.failed++;
    }
  }

  return summary;
}

function main() {
  const options = parseArguments(process.argv);
  loadLocalEnv();

  try {
    const summary = ingest(options);
    console.log(`\nFinished: ${summary.processed} processed, ${summary.skipped} skipped, ${summary.failed} failed.`);
    if (summary.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error(`\nIngestion failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  collectFiles,
  documentName,
  ingest,
  parseArguments
};
