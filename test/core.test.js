import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  TailCapture,
  buildReport,
  createRedactor,
  detectProject,
  displayCommand,
  failureFingerprint,
  parseArgs,
  runCommand,
  stripAnsi,
} from "../src/core.js";

test("parses wrapper options and preserves command arguments", () => {
  assert.deepEqual(parseArgs(["--output", "bug.md", "--max-output", "64", "--no-git", "--", "npm", "test", "--", "watch"]), {
    command: "npm",
    commandArgs: ["test", "--", "watch"],
    output: "bug.md",
    maxOutput: 65_536,
    includeGit: false,
    help: false,
    version: false,
  });
  assert.throws(() => parseArgs(["--wat", "npm"]), /Unknown option/);
  assert.throws(() => parseArgs(["--max-output", "0", "--", "npm"]), /positive number/);
});

test("redacts common credentials and personal paths", () => {
  const redactor = createRedactor({ home: "C:\\Users\\Avery" });
  // Assemble fake keys at runtime so repository scanners do not mistake the
  // fixtures for live credentials.
  const fakeGitHubToken = ["github", "pat", "1234567890abcdefghijklmnop"].join("_");
  const fakeAwsKey = ["AKIA", "1234567890ABCDEF"].join("");
  const input = [
    "C:\\Users\\Avery\\work\\app",
    "person@example.com",
    "Authorization: Bearer abc.def.ghi",
    "api_key=live-secret",
    "DATABASE_PASSWORD=database-secret",
    "https://user:password@example.test/path",
    fakeGitHubToken,
    fakeAwsKey,
  ].join("\n");
  const output = redactor.redact(input);

  assert.doesNotMatch(output, /Avery|person@example|abc\.def|live-secret|database-secret|user:password|github_pat_|AKIA123/);
  assert.match(output, /~\\work\\app/);
  assert.match(output, /<EMAIL>|<SECRET>|<CREDENTIALS>|<GITHUB_TOKEN>|<AWS_ACCESS_KEY>/);
  assert.ok(redactor.replacementCount >= 8);
});

test("tail capture keeps the useful end and marks truncation", () => {
  const capture = new TailCapture(1024);
  capture.append("a".repeat(900));
  capture.append("b".repeat(900));

  assert.equal(capture.truncated, true);
  assert.match(capture.text(), /^\[\.\.\. earlier output omitted \.\.\.\]/);
  assert.match(capture.text(), /b{100}$/);
  assert.ok(capture.text().length < 1100);
});

test("detects project markers without reading source files", () => {
  const directory = mkdtempSync(join(tmpdir(), "failpack-project-"));
  try {
    writeFileSync(join(directory, "package.json"), JSON.stringify({ packageManager: "pnpm@10.0.0" }));
    writeFileSync(join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const project = detectProject(directory);
    assert.equal(project.packageManager, "pnpm@10.0.0");
    assert.deepEqual(project.markers.map((marker) => marker.file), ["package.json", "pnpm-lock.yaml"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("builds stable, valid Markdown around hostile output", () => {
  const run = {
    command: "npm",
    args: ["test", "argument with ``` inside"],
    exitCode: 1,
    signal: null,
    durationMs: 1234,
    stdout: "log with ``` inside\n",
    stderr: "Error at 2026-07-21T10:00:00Z 0xABCDEF\n",
    spawnError: "",
  };
  const environment = {
    os: "Windows 11",
    platform: "win32",
    arch: "x64",
    tools: { Node: "v25.0.0 | custom" },
    project: { name: "demo`project", markers: [{ file: "package.json", kind: "Node.js" }], packageManager: "npm@11" },
  };
  const report = buildReport({ run, environment, git: null, redactions: 2, generatedAt: new Date("2026-07-21T00:00:00Z") });

  assert.match(report.markdown, /````text\nlog with ``` inside\n````/);
  assert.match(report.markdown, /v25\.0\.0 \\| custom/);
  assert.match(report.markdown, /````text\n\$ npm test "argument with ``` inside"\n````/);
  assert.match(report.markdown, /Failure ID: `[a-f0-9]{12}`/);
  assert.equal(failureFingerprint(run), failureFingerprint({ ...run, durationMs: 9999, stderr: "Error at 2027-01-01T01:02:03Z 0x1234\n" }));
  assert.equal(stripAnsi("\u001b[31mfail\u001b[0m"), "fail");
  assert.equal(displayCommand("node", ["hello world.js"]), 'node "hello world.js"');
});

test("runs a command and captures its real exit code", async () => {
  const result = await runCommand(process.execPath, ["-e", "console.log('out'); console.error('err'); process.exit(7)"], {
    maxOutput: 4096,
  });

  assert.equal(result.exitCode, 7);
  assert.match(result.stdout, /out/);
  assert.match(result.stderr, /err/);
});
