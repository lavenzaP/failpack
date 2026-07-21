#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  VERSION,
  buildReport,
  collectEnvironment,
  collectGit,
  createRedactor,
  parseArgs,
  runCommand,
} from "../src/core.js";

const HELP = `Failpack ${VERSION}

Turn one command run into a sanitized, shareable Markdown report.

Usage:
  failpack [options] -- <command> [args...]
  failpack [options] <command> [args...]

Options:
  -o, --output <file>   Report path (default: timestamped file in cwd)
      --max-output <KB> Keep the last KB of stdout and stderr (default: 512)
      --no-git          Skip branch, commit, status, and diff summaries
  -h, --help            Show help
  -v, --version         Show version
`;

function defaultOutputPath(cwd, generatedAt) {
  const timestamp = generatedAt.toISOString().replace(/[:.]/g, "-");
  return resolve(cwd, `failpack-${timestamp}.md`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`failpack: ${error.message}`);
    console.error("Run 'failpack --help' for usage.");
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(HELP);
    return;
  }
  if (options.version) {
    console.log(VERSION);
    return;
  }
  if (!options.command) {
    console.error("failpack: missing command");
    console.error("Example: failpack -- npm test");
    process.exitCode = 2;
    return;
  }

  const cwd = process.cwd();
  const generatedAt = new Date();
  const environment = collectEnvironment(cwd);
  const git = options.includeGit ? collectGit(cwd) : null;

  const run = await runCommand(options.command, options.commandArgs, {
    cwd,
    maxOutput: options.maxOutput,
    onStdout: (chunk) => process.stdout.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  });

  const redactor = createRedactor();
  const sanitizedRun = {
    ...run,
    command: redactor.redact(run.command),
    args: run.args.map((argument) => redactor.redact(argument)),
    stdout: redactor.redact(run.stdout),
    stderr: redactor.redact(run.stderr),
  };
  const sanitizedGit = git
    ? {
        ...git,
        branch: redactor.redact(git.branch),
        status: git.status.map((line) => redactor.redact(line)),
        unstaged: git.unstaged.map((line) => redactor.redact(line)),
        staged: git.staged.map((line) => redactor.redact(line)),
      }
    : null;
  const sanitizedEnvironment = {
    ...environment,
    os: redactor.redact(environment.os),
    tools: Object.fromEntries(
      Object.entries(environment.tools).map(([name, value]) => [name, redactor.redact(value)]),
    ),
    project: {
      ...environment.project,
      name: redactor.redact(environment.project.name),
      packageManager: redactor.redact(environment.project.packageManager),
    },
  };
  const report = buildReport({
    run: sanitizedRun,
    environment: sanitizedEnvironment,
    git: sanitizedGit,
    redactions: redactor.replacementCount,
    generatedAt,
  });
  const outputPath = options.output ? resolve(cwd, options.output) : defaultOutputPath(cwd, generatedAt);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, report.markdown, { encoding: "utf8", flag: "w" });

  console.error(`\nFailpack wrote ${outputPath}`);
  console.error(`Failure ID: ${report.fingerprint} · redactions: ${redactor.replacementCount}`);
  process.exitCode = run.exitCode === 0 ? 0 : run.exitCode || 1;
}

main().catch((error) => {
  console.error(`failpack: ${error.stack || error.message}`);
  process.exitCode = 1;
});
