# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Telegram bot (Node.js, CommonJS, no build step) that bridges chat messages to a
headless `claude -p` run inside a *separate* folder of household documents (the
"wiki", at `HOMEWIKI_PATH`). This repo is the bridge; the wiki is the user's own
data and is never in this repo. `template/` is a one-time scaffold copied at
setup — changes to it never propagate to an existing wiki.

## Commands

```bash
npm install
npm run setup     # interactive first run: writes .env and users.json, scaffolds a wiki
npm start         # node bot.js, foreground
```

There is no test suite, no linter, and no build. Verification is manual: start
the bot, message it from Telegram, use `/whoami`, and confirm an unlisted
account gets no reply at all. `bot.err.log` / `bot.out.log` are where a
service-run bot reports failures.

Nothing picks up code changes on its own — a running service must be restarted
(`launchctl kickstart -k gui/$(id -u)/com.homewiki.bot`, `systemctl --user
restart homewiki-bot`, or `schtasks /end` + `/run` for the `homewiki-bot`
scheduled task on Windows).

**Only one instance may run.** Nothing enforces it; a second fights the first
for Telegram's long-poll (409s) and clobbers `history.json`, which each process
holds in memory and rewrites whole.

## Architecture

Four files carry everything:

- [bot.js](bot.js) — the whole bot: permission config, message dispatch, queue,
  cost guards, note/upload writing. Read the section comments; each one records
  a failure that motivated the code below it.
- [claude-cli.js](claude-cli.js) — portable spawn of the Claude CLI, plus
  `killTree` for timeouts.
- [setup.js](setup.js) — interactive first-run config writer.
- [scripts/install-service.{sh,ps1}](scripts/) — launchd / systemd user unit /
  Windows Scheduled Task, driven by `run-bot.{sh,cmd,vbs}`.

Message flow in `bot.js`, in the order the `bot.on('message')` handler applies
it: `identify()` (own-property lookup in `users.json`) → `isPrivateChat()` →
uploads short-circuit here (they bypass every guard below, since they cost
nothing) → message-age drop → queue-depth check → `enqueue()` → slash commands →
`askClaude()`.

Three invariants shape most of the code:

1. **The bot is read-only.** Claude never writes. Notes and uploads are written
   by this process with plain `fs`; Claude supplies at most a filename slug,
   which `sanitizeSlug()` reduces to `[a-z0-9-]`. Don't add a write path through
   Claude — the permission config and the README's security section both promise
   otherwise.
2. **Every text message is a billed run.** The guards are constants at the top
   of `bot.js` (`MAX_MESSAGE_AGE_MS`, `CLAUDE_TIMEOUT_MS`, `MAX_QUEUE_DEPTH`,
   `MAX_PROMPT_CHARS`, `MAX_HISTORY`, `MAX_CONCURRENT_UPLOADS`). The age drop
   exists because Telegram replays up to 24h of backlog on reconnect, and it
   also defuses a crash-redelivery loop.
3. **The prompt may be hostile.** Documents come from third parties. Anything
   arriving over the wire (message text, `file_name`, Claude's own output) is
   treated as attacker-influenced.

History is a fixed window (`MAX_HISTORY` exchanges per chat in `history.json`),
replayed as a fenced `<recent_conversation>` block. Each run is otherwise a
fresh session — deliberately not `--resume`, which replays the whole transcript
and grew to ~127k tokens per run.

Classification (question vs. statement) happens *inside* the run the message was
going to make anyway: `NOTE_PROTOCOL_INSTRUCTION` asks for a bare
`NOTE_TO_IMPORT: <slug>` reply, matched by `NOTE_REPLY_RE` against the **whole**
trimmed reply — a substring match would let a document echoing the marker swallow
an answer. `/note` and `/ask` override the classifier either way.

## Security constraints that must not be relaxed

These were each established by a failure; the README's Security section is the
long form.

- `--permission-mode dontAsk` is load-bearing. `acceptEdits` and the default
  mode auto-approve unlisted read-only shell (`whoami`, `cat` of arbitrary
  files). Never switch modes to "fix" a permission error.
- File-path rules must be **cwd-relative globs** (`Read(**)`). Absolute paths in
  any spelling silently match nothing, so the tool is refused, not permitted.
  `cwd` is `HOMEWIKI_PATH`, so `**` is already scoped to the wiki.
- `Glob` and `Grep` must stay path-scoped. `Grep` returns matching lines, so
  unscoped it is an exfiltration primitive as capable as `Read`.
- `DENY_RULES` must keep denying `Write`/`Edit`/`NotebookEdit` even though the
  allowlist already omits them: these runs inherit the user's global
  `~/.claude/settings.json`, where an `allow` rule could re-grant writes. Deny
  wins.
- Prompts go in on **stdin**, never as argv.
- Never spawn the CLI with `shell: true` on Windows — it concatenates args
  unescaped, cmd.exe strips the quotes out of `--settings {json}`, and the deny
  rules silently fail to apply. `claude-cli.js` quotes the command line itself.
- Upload names are **rebuilt**, not sanitized: `safeUploadName()` forces
  `upload-<slug><ext>`. `basename()` alone would allow an uploaded `CLAUDE.md`,
  which Claude Code reads as *instructions*.
- Errors reaching a chat must use `reportable()`/`chatSafeMessage()`. Raw
  `err.message` can carry absolute paths, stderr, or the API URL with the bot
  token in it; raw stdout is wiki content that never passed the masking rules.
- Private chats only, and `chat.id` must equal `from.id`. Group messages are
  dropped **silently**, same as an unlisted sender, so adding the bot to a group
  reveals nothing about the whitelist.

## Local files

`.env`, `users.json`, `history.json` and `*.log` are gitignored and hold the bot
token, real names/Telegram IDs, and verbatim medical/financial conversation
excerpts. The first three are written `0600`. Don't commit them or paste log
excerpts anywhere without reading them first.
