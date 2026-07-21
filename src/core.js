import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { arch, homedir, platform, release, type } from "node:os";

export const VERSION = "0.1.0";
export const DEFAULT_MAX_OUTPUT = 512 * 1024;

const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

const PROJECT_MARKERS = [
  ["package.json", "Node.js"],
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "Yarn"],
  ["bun.lock", "Bun"],
  ["pyproject.toml", "Python"],
  ["requirements.txt", "Python"],
  ["Pipfile", "Python"],
  ["uv.lock", "uv"],
  ["Cargo.toml", "Rust"],
  ["go.mod", "Go"],
  ["pom.xml", "Java/Maven"],
  ["build.gradle", "Java/Gradle"],
  ["build.gradle.kts", "Kotlin/Gradle"],
  ["composer.json", "PHP/Composer"],
  ["Gemfile", "Ruby"],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

export function stripAnsi(value) {
  return String(value).replace(ANSI_PATTERN, "");
}

export function createRedactor(options = {}) {
  const home = options.home || homedir();
  let replacementCount = 0;

  function replace(value, pattern, replacement) {
    const count = countMatches(value, pattern);
    replacementCount += count;
    return count ? value.replace(pattern, replacement) : value;
  }

  function redact(input) {
    let value = stripAnsi(input);
    if (home) {
      value = replace(value, new RegExp(escapeRegExp(home), "gi"), "~");
      value = replace(value, new RegExp(escapeRegExp(home.replaceAll("\\", "/")), "gi"), "~");
    }
    value = replace(value, /\b([A-Za-z]:(?:\\+|\/+)(?:Users|Documents and Settings)(?:\\+|\/+))([^\\/\s"'<>]+)/gi, "$1<USER>");
    value = replace(value, /\/(home|Users)\/[^/\s"'<>]+/g, "/$1/<USER>");
    value = replace(value, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<EMAIL>");
    value = replace(value, /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "<GITHUB_TOKEN>");
    value = replace(value, /\bAKIA[0-9A-Z]{16}\b/g, "<AWS_ACCESS_KEY>");
    value = replace(value, /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, "<API_KEY>");
    value = replace(value, /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<JWT>");
    value = replace(value, /\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1<SECRET>");
    value = replace(value, /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1<CREDENTIALS>@");
    value = replace(
      value,
      /\b([a-z][a-z0-9_-]*(?:api[_-]?key|token|password|passwd|pwd|secret)|api[_-]?key|token|password|passwd|pwd|secret)\s*([:=])\s*(["']?)([^\s,"';]+)\3/gi,
      "$1$2<SECRET>",
    );
    return value;
  }

  return {
    redact,
    get replacementCount() {
      return replacementCount;
    },
  };
}

export class TailCapture {
  constructor(limit = DEFAULT_MAX_OUTPUT) {
    this.limit = Math.max(1024, limit);
    this.value = "";
    this.truncated = false;
  }

  append(chunk) {
    this.value += String(chunk);
    if (this.value.length > this.limit) {
      this.value = this.value.slice(this.value.length - this.limit);
      this.truncated = true;
    }
  }

  text() {
    return this.truncated ? `[... earlier output omitted ...]\n${this.value}` : this.value;
  }
}

export function parseArgs(argv) {
  const options = {
    command: "",
    commandArgs: [],
    output: "",
    maxOutput: DEFAULT_MAX_OUTPUT,
    includeGit: true,
    help: false,
    version: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      options.command = argv[index + 1] || "";
      options.commandArgs = argv.slice(index + 2);
      break;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--version" || argument === "-v") {
      options.version = true;
      continue;
    }
    if (argument === "--no-git") {
      options.includeGit = false;
      continue;
    }
    if (argument === "--output" || argument === "-o") {
      options.output = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (argument.startsWith("--output=")) {
      options.output = argument.slice("--output=".length);
      continue;
    }
    if (argument === "--max-output") {
      const kilobytes = Number(argv[index + 1]);
      if (!Number.isFinite(kilobytes) || kilobytes < 1) throw new Error("--max-output must be a positive number of KB");
      options.maxOutput = Math.round(kilobytes * 1024);
      index += 1;
      continue;
    }
    if (argument.startsWith("--max-output=")) {
      const kilobytes = Number(argument.slice("--max-output=".length));
      if (!Number.isFinite(kilobytes) || kilobytes < 1) throw new Error("--max-output must be a positive number of KB");
      options.maxOutput = Math.round(kilobytes * 1024);
      continue;
    }
    if (argument.startsWith("-") && !options.command) throw new Error(`Unknown option: ${argument}`);

    options.command = argument;
    options.commandArgs = argv.slice(index + 1);
    break;
  }

  if ((argv.includes("--output") || argv.includes("-o")) && !options.output) {
    throw new Error("--output requires a file path");
  }
  return options;
}

function quoteArgument(value) {
  const string = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(string)) return string;
  return `"${string.replaceAll('"', '\\"')}"`;
}

export function displayCommand(command, args = []) {
  return [command, ...args].map(quoteArgument).join(" ");
}

function resolveWindowsExecutable(command, cwd) {
  if (/[\\/]/.test(command) || /\.[A-Za-z0-9]+$/.test(command)) return command;
  const lookup = spawnSync("where.exe", [command], { cwd, encoding: "utf8", windowsHide: true });
  if (lookup.status !== 0) return command;
  const candidates = String(lookup.stdout).split(/\r?\n/).filter(Boolean);
  return candidates.find((candidate) => /\.exe$/i.test(candidate))
    || candidates.find((candidate) => /\.(?:cmd|bat|com)$/i.test(candidate))
    || candidates[0]
    || command;
}

function quoteWindowsShellArgument(value) {
  const string = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(string)) return string;
  return `"${string.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function commandInvocation(command, args, cwd) {
  if (process.platform !== "win32") return { command, args };
  const executable = resolveWindowsExecutable(command, cwd);
  if (!/\.(?:cmd|bat)$/i.test(executable)) return { command: executable, args };
  const commandLine = [executable, ...args].map(quoteWindowsShellArgument).join(" ");
  return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", commandLine] };
}

function runQuiet(command, args, cwd) {
  try {
    const invocation = commandInvocation(command, args, cwd);
    const result = spawnSync(invocation.command, invocation.args, {
      cwd,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    if (result.status !== 0) return "";
    return stripAnsi(`${result.stdout || ""}${result.stderr || ""}`).trim();
  } catch {
    return "";
  }
}

export function detectProject(cwd) {
  const markers = PROJECT_MARKERS.filter(([file]) => existsSync(join(cwd, file))).map(([file, kind]) => ({ file, kind }));
  let packageManager = "";
  const packagePath = join(cwd, "package.json");
  if (existsSync(packagePath)) {
    try {
      packageManager = JSON.parse(readFileSync(packagePath, "utf8")).packageManager || "";
    } catch {
      packageManager = "package.json could not be parsed";
    }
  }
  return { name: basename(cwd), markers, packageManager };
}

export function collectEnvironment(cwd) {
  const project = detectProject(cwd);
  const kinds = new Set(project.markers.map((marker) => marker.kind));
  const firstLine = (value) => value.split(/\r?\n/)[0];
  const tools = { Node: process.version, Git: firstLine(runQuiet("git", ["--version"], cwd)) };

  if (kinds.has("npm")) tools.npm = firstLine(runQuiet("npm", ["--version"], cwd));
  if (kinds.has("pnpm")) tools.pnpm = firstLine(runQuiet("pnpm", ["--version"], cwd));
  if (kinds.has("Yarn")) tools.Yarn = firstLine(runQuiet("yarn", ["--version"], cwd));
  if (kinds.has("Bun")) tools.Bun = firstLine(runQuiet("bun", ["--version"], cwd));
  if (kinds.has("Python") || kinds.has("uv")) tools.Python = firstLine(runQuiet("python", ["--version"], cwd) || runQuiet("python3", ["--version"], cwd));
  if (kinds.has("Rust")) tools.Rust = firstLine(runQuiet("rustc", ["--version"], cwd));
  if (kinds.has("Go")) tools.Go = firstLine(runQuiet("go", ["version"], cwd));
  if ([...kinds].some((kind) => kind.startsWith("Java") || kind.startsWith("Kotlin"))) tools.Java = firstLine(runQuiet("java", ["-version"], cwd));

  return {
    os: `${type()} ${release()}`,
    platform: platform(),
    arch: arch(),
    tools: Object.fromEntries(Object.entries(tools).filter(([, value]) => value)),
    project,
  };
}

export function collectGit(cwd) {
  if (runQuiet("git", ["rev-parse", "--is-inside-work-tree"], cwd) !== "true") return null;
  const status = runQuiet("git", ["status", "--short", "--untracked-files=normal"], cwd);
  const unstaged = runQuiet("git", ["diff", "--stat"], cwd);
  const staged = runQuiet("git", ["diff", "--cached", "--stat"], cwd);
  return {
    branch: runQuiet("git", ["branch", "--show-current"], cwd) || "detached HEAD",
    commit: runQuiet("git", ["rev-parse", "--short", "HEAD"], cwd) || "no commits",
    status: status.split(/\r?\n/).filter(Boolean).slice(0, 100),
    unstaged: unstaged.split(/\r?\n/).filter(Boolean).slice(0, 80),
    staged: staged.split(/\r?\n/).filter(Boolean).slice(0, 80),
  };
}

export function runCommand(command, args = [], options = {}) {
  const cwd = options.cwd || process.cwd();
  const maxOutput = options.maxOutput || DEFAULT_MAX_OUTPUT;
  const stdout = new TailCapture(maxOutput);
  const stderr = new TailCapture(maxOutput);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const invocation = commandInvocation(command, args, cwd);
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: process.env,
      windowsHide: true,
    });
    let spawnError = null;

    child.stdout?.on("data", (chunk) => {
      stdout.append(chunk);
      options.onStdout?.(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr.append(chunk);
      options.onStderr?.(chunk);
    });
    child.on("error", (error) => {
      spawnError = error;
      stderr.append(`${error.name}: ${error.message}\n`);
    });
    child.on("close", (exitCode, signal) => {
      resolve({
        command,
        args,
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        spawnError: spawnError?.code || "",
      });
    });
  });
}

function normalizeFailure(value) {
  return value
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}[t ][\d:.+-]+z?\b/g, "<timestamp>")
    .replace(/\b0x[0-9a-f]+\b/g, "<address>")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|seconds?|secs?)\b/g, "<duration>")
    .replace(/\s+/g, " ")
    .trim();
}

export function failureFingerprint(run) {
  const content = normalizeFailure(`${displayCommand(run.command, run.args)}\n${run.exitCode}\n${run.stderr}\n${run.stdout}`);
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function fenced(value) {
  const clean = value.trimEnd();
  if (!clean) return "_No output captured._";
  const longestRun = Math.max(0, ...[...clean.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${clean}\n${fence}`;
}

function inlineCode(value) {
  const clean = String(value).replace(/\r?\n/g, " ");
  const longestRun = Math.max(0, ...[...clean.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(1, longestRun + 1));
  const padding = clean.startsWith("`") || clean.endsWith("`") ? " " : "";
  return `${fence}${padding}${clean}${padding}${fence}`;
}

function tableCell(value) {
  return String(value).replace(/\r?\n/g, " ").replaceAll("|", "\\|");
}

export function buildReport(data) {
  const { run, environment, git, redactions, generatedAt } = data;
  const command = displayCommand(run.command, run.args);
  const outcome = run.exitCode === 0 ? "completed successfully" : run.spawnError ? `could not start (${run.spawnError})` : `exited with code ${run.exitCode ?? "unknown"}`;
  const fingerprint = failureFingerprint(run);
  const toolRows = Object.entries(environment.tools).map(([name, value]) => `| ${tableCell(name)} | ${tableCell(value)} |`);
  const markerList = environment.project.markers.map((marker) => inlineCode(marker.file)).join(", ") || "None detected";
  const lines = [
    "# Failpack report",
    "",
    `> ${inlineCode(command)} ${outcome} after ${(run.durationMs / 1000).toFixed(2)}s.`,
    "",
    `Failure ID: \`${fingerprint}\``,
    "",
    "## Reproduction",
    "",
    fenced(`$ ${command}`),
    "",
    "## Expected behavior",
    "",
    "<!-- Add what you expected to happen. -->",
    "",
    "## Actual behavior",
    "",
    `The command ${outcome}.`,
    "",
    "### Standard error",
    "",
    fenced(run.stderr),
    "",
    "### Standard output",
    "",
    fenced(run.stdout),
    "",
    "## Environment",
    "",
    "| Item | Value |",
    "| --- | --- |",
    `| OS | ${tableCell(environment.os)} |`,
    `| Platform | ${tableCell(`${environment.platform} ${environment.arch}`)} |`,
    ...toolRows,
    "",
    "## Project signals",
    "",
    `- Directory name: ${inlineCode(environment.project.name)}`,
    `- Manifests and lockfiles: ${markerList}`,
  ];

  if (environment.project.packageManager) lines.push(`- Declared package manager: ${inlineCode(environment.project.packageManager)}`);

  lines.push("", "## Git snapshot", "");
  if (!git) {
    lines.push("Git data was unavailable or disabled.", "");
  } else {
    lines.push(`- Branch: ${inlineCode(git.branch)}`, `- Commit: ${inlineCode(git.commit)}`, `- Working tree: ${git.status.length ? `${git.status.length} changed path(s)` : "clean"}`, "");
    if (git.status.length) lines.push(fenced(git.status.join("\n")), "");
    if (git.unstaged.length) lines.push("Unstaged diff summary:", "", fenced(git.unstaged.join("\n")), "");
    if (git.staged.length) lines.push("Staged diff summary:", "", fenced(git.staged.join("\n")), "");
  }

  lines.push(
    "## Sharing checklist",
    "",
    "- [ ] I added the expected behavior above.",
    "- [ ] I reviewed the captured output for project-specific sensitive data.",
    "- [ ] I can reproduce the failure with the command shown here.",
    "",
    "---",
    "",
    `Generated by Failpack ${VERSION} at ${generatedAt.toISOString()}. ${redactions} path, email, or credential-like value(s) were replaced. Environment-variable values, source files, hostnames, IP addresses, and Git remotes were not collected.`,
    "",
  );
  return { markdown: lines.join("\n"), fingerprint };
}
