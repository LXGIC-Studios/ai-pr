# @lxgicstudios/ai-pr

[![npm version](https://img.shields.io/npm/v/@lxgicstudios/ai-pr.svg)](https://www.npmjs.com/package/@lxgicstudios/ai-pr)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

Generate pull request descriptions from git diff. Automatically summarizes changes, lists modified files, detects breaking changes, and suggests reviewers.

## Install

```bash
npm install -g @lxgicstudios/ai-pr
```

Or run directly:

```bash
npx @lxgicstudios/ai-pr
```

## Usage

```bash
# Basic - diff against main branch
ai-pr

# Diff against a specific branch
ai-pr --base develop

# Output as markdown
ai-pr --markdown

# Save to file
ai-pr --markdown --output pr-description.md

# Detect breaking changes
ai-pr --breaking

# JSON output (great for CI/CD)
ai-pr --json
```

## Features

- Zero dependencies - uses only Node.js builtins
- Generates PR descriptions from git diff automatically
- Categorizes files (Source, Tests, Config, CI/CD, Docs, Styles)
- Detects breaking changes from commits and removed exports
- Suggests reviewers based on git history
- Colorful terminal output with clean formatting
- Markdown output for direct pasting into PRs
- JSON output for CI/CD integration
- Works with any git repository

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--base <branch>` | Base branch to diff against | `main` |
| `--template` | Use conventional commit format | `false` |
| `--breaking` | Highlight breaking changes | `false` |
| `--markdown` | Output raw markdown | `false` |
| `--output <file>` | Write markdown to file | - |
| `--json` | Output as JSON | `false` |
| `--help` | Show help message | - |

## License

MIT

---

**Built by [LXGIC Studios](https://lxgicstudios.com)**
