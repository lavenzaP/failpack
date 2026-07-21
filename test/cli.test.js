import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cli = resolve("bin/failpack.js");

test("CLI writes a sanitized report and returns the wrapped exit code", () => {
  const directory = mkdtempSync(join(tmpdir(), "failpack-cli-"));
  const output = join(directory, "report.md");
  try {
    writeFileSync(join(directory, "package.json"), JSON.stringify({ packageManager: "npm@11-contact@example.com" }));
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "--no-git",
        "--output",
        output,
        "--",
        process.execPath,
        "-e",
        "console.error('C:\\\\Users\\\\Avery\\\\app api_key=live-secret'); process.exit(7)",
      ],
      { cwd: directory, encoding: "utf8", windowsHide: true },
    );
    const report = readFileSync(output, "utf8");

    assert.equal(result.status, 7, result.stderr);
    assert.match(result.stderr, /Failpack wrote/);
    assert.match(report, /api_key=<SECRET>/);
    assert.doesNotMatch(report, /Avery|live-secret|contact@example\.com/);
    assert.match(report, /npm@<EMAIL>/);
    assert.match(report, /exited with code 7/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
