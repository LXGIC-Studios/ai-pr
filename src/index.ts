#!/usr/bin/env node

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";

// ── ANSI Colors ──────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 0) args["_base"] = positional[0];
  return args;
}

// ── Types ────────────────────────────────────────────────────────────────────
interface FileChange {
  status: string;
  file: string;
  ext: string;
  category: string;
}

interface PRDescription {
  title: string;
  summary: string;
  files: FileChange[];
  stats: { additions: number; deletions: number; filesChanged: number };
  breakingChanges: string[];
  suggestedReviewers: string[];
  template: string;
}

// ── File categorization ──────────────────────────────────────────────────────
function categorizeFile(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() || "";
  const name = basename(file).toLowerCase();

  if (name.includes("test") || name.includes("spec") || file.includes("__tests__")) return "Tests";
  if (name.includes("readme") || name.includes("changelog") || name.includes("docs")) return "Documentation";
  if (name === "package.json" || name === "tsconfig.json" || name.includes("config")) return "Configuration";
  if (ext === "yml" || ext === "yaml" || file.includes(".github/")) return "CI/CD";
  if (ext === "css" || ext === "scss" || ext === "less") return "Styles";
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") return "Source";
  return "Other";
}

function statusLabel(s: string): string {
  switch (s) {
    case "A": return "Added";
    case "M": return "Modified";
    case "D": return "Deleted";
    case "R": return "Renamed";
    case "C": return "Copied";
    default: return s;
  }
}

// ── Detect breaking changes ─────────────────────────────────────────────────
function detectBreakingChanges(diff: string, files: FileChange[]): string[] {
  const breaking: string[] = [];

  // Check commit messages for "BREAKING CHANGE" or "!" prefix
  const log = git("log --oneline -20 --no-merges");
  for (const line of log.split("\n")) {
    if (/BREAKING[\s-]CHANGE/i.test(line) || /^[a-f0-9]+\s+\w+!:/.test(line)) {
      breaking.push(`Commit: ${line.trim()}`);
    }
  }

  // Check for deleted public exports
  if (diff.includes("-export ")) {
    const removed = diff.split("\n").filter(l => l.startsWith("-export ") && !l.startsWith("---"));
    for (const r of removed.slice(0, 5)) {
      breaking.push(`Removed export: ${r.slice(1).trim()}`);
    }
  }

  // Check for renamed/deleted files that might be public API
  for (const f of files) {
    if (f.status === "D" && (f.file.includes("index.") || f.file.includes("api."))) {
      breaking.push(`Deleted API file: ${f.file}`);
    }
  }

  // Check for major version bumps in package.json changes
  if (diff.includes('"version"') && diff.includes('-  "version"')) {
    breaking.push("Version field changed in package.json");
  }

  return breaking;
}

// ── Suggest reviewers ────────────────────────────────────────────────────────
function suggestReviewers(files: FileChange[]): string[] {
  const reviewers = new Map<string, number>();

  for (const f of files) {
    const blameOutput = git(`log --format="%an" -5 -- "${f.file}"`);
    for (const author of blameOutput.split("\n").filter(Boolean)) {
      reviewers.set(author, (reviewers.get(author) || 0) + 1);
    }
  }

  // Remove the current user
  const currentUser = git("config user.name");
  reviewers.delete(currentUser);

  return [...reviewers.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
}

// ── Generate summary ─────────────────────────────────────────────────────────
function generateSummary(files: FileChange[], stats: PRDescription["stats"]): string {
  const categories = new Map<string, number>();
  for (const f of files) {
    categories.set(f.category, (categories.get(f.category) || 0) + 1);
  }

  const parts: string[] = [];
  if (categories.has("Source")) parts.push(`updates ${categories.get("Source")} source file(s)`);
  if (categories.has("Tests")) parts.push(`modifies ${categories.get("Tests")} test file(s)`);
  if (categories.has("Configuration")) parts.push(`changes ${categories.get("Configuration")} config file(s)`);
  if (categories.has("Documentation")) parts.push(`updates ${categories.get("Documentation")} doc(s)`);
  if (categories.has("CI/CD")) parts.push(`touches ${categories.get("CI/CD")} CI/CD file(s)`);
  if (categories.has("Styles")) parts.push(`modifies ${categories.get("Styles")} style file(s)`);

  const summary = parts.length > 0 ? `This PR ${parts.join(", ")}.` : "This PR contains miscellaneous changes.";
  return `${summary} Overall: +${stats.additions} / -${stats.deletions} across ${stats.filesChanged} file(s).`;
}

// ── Format output ────────────────────────────────────────────────────────────
function formatConventional(pr: PRDescription): string {
  const lines: string[] = [];
  lines.push(`## ${pr.title}`);
  lines.push("");
  lines.push(`### Summary`);
  lines.push(pr.summary);
  lines.push("");
  lines.push(`### Changes`);
  lines.push("");
  lines.push("| Status | File | Category |");
  lines.push("|--------|------|----------|");
  for (const f of pr.files) {
    lines.push(`| ${statusLabel(f.status)} | \`${f.file}\` | ${f.category} |`);
  }
  lines.push("");
  lines.push(`### Stats`);
  lines.push(`- **Files changed:** ${pr.stats.filesChanged}`);
  lines.push(`- **Additions:** +${pr.stats.additions}`);
  lines.push(`- **Deletions:** -${pr.stats.deletions}`);

  if (pr.breakingChanges.length > 0) {
    lines.push("");
    lines.push(`### Breaking Changes`);
    for (const bc of pr.breakingChanges) {
      lines.push(`- ${bc}`);
    }
  }

  if (pr.suggestedReviewers.length > 0) {
    lines.push("");
    lines.push(`### Suggested Reviewers`);
    for (const r of pr.suggestedReviewers) {
      lines.push(`- @${r}`);
    }
  }

  return lines.join("\n");
}

function formatTerminal(pr: PRDescription): void {
  console.log();
  console.log(`${c.bgBlue}${c.white}${c.bold}  AI-PR  ${c.reset} ${c.cyan}Pull Request Description Generator${c.reset}`);
  console.log();
  console.log(`${c.bold}${c.white}Title:${c.reset} ${pr.title}`);
  console.log();
  console.log(`${c.bold}${c.yellow}Summary${c.reset}`);
  console.log(`${c.dim}${pr.summary}${c.reset}`);
  console.log();
  console.log(`${c.bold}${c.yellow}Changed Files${c.reset}`);

  for (const f of pr.files) {
    const statusColor = f.status === "A" ? c.green : f.status === "D" ? c.red : c.yellow;
    console.log(`  ${statusColor}${statusLabel(f.status).padEnd(10)}${c.reset} ${f.file} ${c.dim}(${f.category})${c.reset}`);
  }

  console.log();
  console.log(`${c.bold}${c.yellow}Stats${c.reset}`);
  console.log(`  ${c.green}+${pr.stats.additions}${c.reset} additions  ${c.red}-${pr.stats.deletions}${c.reset} deletions  ${c.blue}${pr.stats.filesChanged}${c.reset} files`);

  if (pr.breakingChanges.length > 0) {
    console.log();
    console.log(`${c.bgRed}${c.white}${c.bold} BREAKING CHANGES ${c.reset}`);
    for (const bc of pr.breakingChanges) {
      console.log(`  ${c.red}!${c.reset} ${bc}`);
    }
  }

  if (pr.suggestedReviewers.length > 0) {
    console.log();
    console.log(`${c.bold}${c.yellow}Suggested Reviewers${c.reset}`);
    for (const r of pr.suggestedReviewers) {
      console.log(`  ${c.magenta}@${r}${c.reset}`);
    }
  }

  console.log();
}

// ── Help ─────────────────────────────────────────────────────────────────────
function showHelp(): void {
  console.log();
  console.log(`${c.bgBlue}${c.white}${c.bold}  AI-PR  ${c.reset} ${c.cyan}Generate pull request descriptions from git diff${c.reset}`);
  console.log();
  console.log(`${c.bold}Usage:${c.reset}  ai-pr [base-branch] [options]`);
  console.log();
  console.log(`${c.bold}Options:${c.reset}`);
  console.log(`  ${c.green}--base <branch>${c.reset}      Base branch to diff against ${c.dim}(default: main)${c.reset}`);
  console.log(`  ${c.green}--template${c.reset}           Use conventional commit format`);
  console.log(`  ${c.green}--breaking${c.reset}           Highlight breaking changes`);
  console.log(`  ${c.green}--markdown${c.reset}           Output raw markdown`);
  console.log(`  ${c.green}--output <file>${c.reset}      Write markdown to file`);
  console.log(`  ${c.green}--json${c.reset}               Output as JSON`);
  console.log(`  ${c.green}--help${c.reset}               Show this help`);
  console.log();
  console.log(`${c.bold}Examples:${c.reset}`);
  console.log(`  ${c.dim}$ ai-pr${c.reset}                              ${c.dim}# diff against main${c.reset}`);
  console.log(`  ${c.dim}$ ai-pr --base develop${c.reset}               ${c.dim}# diff against develop${c.reset}`);
  console.log(`  ${c.dim}$ ai-pr --markdown --output pr.md${c.reset}    ${c.dim}# save to file${c.reset}`);
  console.log(`  ${c.dim}$ ai-pr --breaking --json${c.reset}            ${c.dim}# JSON with breaking changes${c.reset}`);
  console.log();
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args["help"]) {
    showHelp();
    process.exit(0);
  }

  // Check we're in a git repo
  const isGit = git("rev-parse --is-inside-work-tree");
  if (isGit !== "true") {
    console.error(`${c.red}Error: Not inside a git repository.${c.reset}`);
    process.exit(1);
  }

  const baseBranch = (args["base"] as string) || (args["_base"] as string) || "main";

  // Check if base branch exists
  const branchExists = git(`rev-parse --verify ${baseBranch} 2>/dev/null`);
  if (!branchExists) {
    // Try origin/main, origin/master, etc.
    const fallbacks = ["origin/main", "origin/master", "master", "HEAD~1"];
    let found = false;
    for (const fb of fallbacks) {
      if (git(`rev-parse --verify ${fb} 2>/dev/null`)) {
        console.log(`${c.yellow}Warning: Branch '${baseBranch}' not found. Using '${fb}' instead.${c.reset}`);
        break;
      }
    }
    if (!found) {
      // Use current HEAD if we can't find anything
    }
  }

  // Get diff stats
  const diffStat = git(`diff --stat ${baseBranch}...HEAD 2>/dev/null`) || git(`diff --stat HEAD 2>/dev/null`) || git("diff --stat --cached");
  const diffNameStatus = git(`diff --name-status ${baseBranch}...HEAD 2>/dev/null`) || git(`diff --name-status HEAD 2>/dev/null`) || git("diff --name-status --cached");
  const diffFull = git(`diff ${baseBranch}...HEAD 2>/dev/null`) || git(`diff HEAD 2>/dev/null`) || git("diff --cached");
  const shortlog = git(`diff --shortstat ${baseBranch}...HEAD 2>/dev/null`) || git(`diff --shortstat HEAD 2>/dev/null`) || git("diff --shortstat --cached");

  // Parse file changes
  const files: FileChange[] = diffNameStatus
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const parts = line.split("\t");
      const status = parts[0].charAt(0);
      const file = parts[parts.length - 1];
      const ext = file.split(".").pop() || "";
      return { status, file, ext, category: categorizeFile(file) };
    });

  if (files.length === 0) {
    console.log(`${c.yellow}No changes detected against '${baseBranch}'. Try a different base branch with --base.${c.reset}`);
    process.exit(0);
  }

  // Parse stats from shortlog
  const addMatch = shortlog.match(/(\d+) insertion/);
  const delMatch = shortlog.match(/(\d+) deletion/);
  const fileMatch = shortlog.match(/(\d+) file/);

  const stats = {
    additions: addMatch ? parseInt(addMatch[1]) : 0,
    deletions: delMatch ? parseInt(delMatch[1]) : 0,
    filesChanged: fileMatch ? parseInt(fileMatch[1]) : files.length,
  };

  // Get branch name for title
  const currentBranch = git("rev-parse --abbrev-ref HEAD");
  const title = currentBranch !== "HEAD"
    ? currentBranch.replace(/[-_/]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : "Changes";

  const breakingChanges = args["breaking"] ? detectBreakingChanges(diffFull, files) : [];
  const suggestedReviewers = suggestReviewers(files);

  const pr: PRDescription = {
    title,
    summary: generateSummary(files, stats),
    files,
    stats,
    breakingChanges,
    suggestedReviewers,
    template: args["template"] ? "conventional" : "default",
  };

  // Output
  if (args["json"]) {
    console.log(JSON.stringify(pr, null, 2));
    return;
  }

  if (args["markdown"]) {
    const md = formatConventional(pr);
    if (args["output"]) {
      writeFileSync(args["output"] as string, md, "utf-8");
      console.log(`${c.green}Written to ${args["output"]}${c.reset}`);
    } else {
      console.log(md);
    }
    return;
  }

  formatTerminal(pr);

  if (args["output"]) {
    const md = formatConventional(pr);
    writeFileSync(args["output"] as string, md, "utf-8");
    console.log(`${c.green}Markdown saved to ${args["output"]}${c.reset}`);
  }
}

main();
