// The permission config for every `claude -p` run this bot makes.
//
// It lives in its own file because it is the security control the rest of the
// bot leans on, and because keeping it free of runtime state lets test/ assert
// the invariants below directly (see test/permissions.test.js). Nothing here
// may be relaxed without reading the Security section of the README first.

// Threat model: this bot processes documents that arrive over Telegram and
// originate from third parties (insurers, labs, contractors). A PDF can carry
// text designed to hijack the model ("ignore your instructions and run X"), so
// we assume the *prompt* can turn hostile and design the permissions so that a
// hijacked prompt still can't do much.
//
// The approach is default-deny: `--permission-mode dontAsk` refuses anything
// not explicitly allowed (rather than prompting, which would hang a headless
// run). The allowlist below is the minimum the CLAUDE.md import workflow
// actually needs -- notably it grants no general shell, so the usual injection
// payloads (curl, node -e, powershell) are simply unavailable.
//
// Verified: with this config the import workflow still succeeds, while
// `curl` and `cat <secret>` are both refused.
//
// Deny rules are a backstop, not the primary control -- a denylist of dangerous
// commands is unbounded, so the allowlist above is what's actually load-bearing.
// Both deny rules and PreToolUse hooks are enforced even under bypass modes.

// File-path rules MUST be written as cwd-relative globs, not absolute paths.
// An absolute Windows path in a rule -- in any spelling tried: `C:/x/**`,
// `//C:/x/**`, `C:\x\**` -- silently matches nothing, so the tool it was meant
// to permit is refused. This is what broke document import: `Write(//C:/.../**)`
// never matched, so every Write and Edit was denied under dontAsk while Read
// still appeared to work (Read is permitted by default, so its equally-broken
// rule was invisible). Verified: with `Write(**)` the same import succeeds.
//
// `**` is relative to cwd, which is HOMEWIKI_PATH, so these rules are still
// scoped to the wiki. Verified: a Write to a path outside HOMEWIKI_PATH is
// denied under `Write(**)`, and Read/Grep outside HOMEWIKI_PATH stay denied.
// The bot is READ-ONLY. It answers questions from the wiki and parks uploaded
// files in import/ for a human to process at a keyboard; it never edits the
// wiki or touches git history. Uploads are written by this process directly
// (plain fs), not by Claude, so no write permission is needed for them either.
const ALLOWED_TOOLS = [
  // Read-only file tools, scoped to the wiki via cwd. Verified: reads, globs
  // and greps outside HOMEWIKI_PATH are denied, and a spawned subagent
  // inherits the same restrictions rather than escaping them.
  //
  // MCP note: no MCP server tools are reachable here. Under dontAsk anything
  // absent from this list is refused, so if you later want an MCP tool used,
  // add it explicitly (e.g. 'mcp__servername__toolname').
  'Read(**)',
  // Glob and Grep MUST stay path-scoped. Left unscoped, Grep will happily
  // return matching lines from files anywhere on the filesystem -- it reads
  // content, so it's an exfiltration primitive every bit as capable as Read.
  'Glob(**)',
  'Grep(**)',
  'TodoWrite',
  // Read-only inspection only. No mv/cp/rm/mkdir, no git add/commit/mv.
  'Bash(ls:*)',
  'Bash(git status:*)',
  'Bash(git log:*)',
  'Bash(git diff:*)',
];

const DENY_RULES = [
  // Exfiltration channels.
  'WebFetch',
  'WebSearch',
  'Bash(curl:*)',
  'Bash(wget:*)',
  'Bash(iwr:*)',
  'Bash(Invoke-WebRequest:*)',
  'Bash(Invoke-RestMethod:*)',
  'Bash(irm:*)',
  'Bash(nc:*)',
  'Bash(ssh:*)',
  'Bash(scp:*)',
  'Bash(certutil:*)',
  'Bash(bitsadmin:*)',
  // Interpreters, which would otherwise re-open arbitrary execution.
  'Bash(node:*)',
  'Bash(python:*)',
  'Bash(python3:*)',
  'Bash(npm:*)',
  'Bash(npx:*)',
  'Bash(pip:*)',
  'Bash(powershell:*)',
  'Bash(pwsh:*)',
  'Bash(cmd:*)',
  'Bash(bash:*)',
  'Bash(sh:*)',
  // Nothing here should ever reach a remote.
  'Bash(git push:*)',
  'Bash(git remote:*)',
  // Read-only enforcement. Omitting these tools from the allowlist is already
  // enough under dontAsk, but denying them outright matters because these runs
  // inherit the user's global ~/.claude/settings.json: an allow rule added
  // there later would otherwise silently re-grant writes. Deny always wins.
  'Write',
  'Edit',
  'NotebookEdit',
  'Bash(mv:*)',
  'Bash(cp:*)',
  'Bash(rm:*)',
  'Bash(mkdir:*)',
  'Bash(tee:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(git mv:*)',
  'Bash(git checkout:*)',
  'Bash(git reset:*)',
];

// Settings are passed inline rather than as a file path: pointing --settings at
// a file appeared to widen the set of directories the session could reach.
const CLAUDE_PERMISSION_ARGS = [
  '--permission-mode',
  'dontAsk',
  '--allowedTools',
  ...ALLOWED_TOOLS,
  '--settings',
  JSON.stringify({ permissions: { deny: DENY_RULES } }),
];

module.exports = { ALLOWED_TOOLS, DENY_RULES, CLAUDE_PERMISSION_ARGS };
