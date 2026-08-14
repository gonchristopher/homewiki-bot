# homewiki-bot

Ask your household's paperwork questions from your phone.

homewiki-bot is a Telegram bridge to a local [Claude Code](https://claude.com/claude-code)
session running against a folder of your own documents — a "home wiki". You
message the bot; it runs `claude -p` headless inside that folder and relays the
answer back. Send it a photo of a bill or a PDF from an insurer and it parks the
file in `import/` for you to file later.

> *"When does the car registration expire?"*
> *"What's my health plan's out-of-network deductible?"*
> *"How much did we pay the HVAC guy, and is the work still under warranty?"*

**Tell it things, too.** A message that states something rather than asks
something — *"the water heater was serviced today, they replaced the filter"* —
isn't answered. It's written to `import/` as a timestamped `.txt`, the same drop
folder your uploads land in, and folded into the wiki next time you process it.

**Ask where a document is** and you get the path, not the document:
*"where's the homeowners policy?"* → `raw/.../Florida Peninsula - Evidence of
Insurance.pdf`, plus what it is and which wiki page covers it. Files never leave
the machine — the bot has no way to send one.

Nothing is exposed to the internet: the bot long-polls Telegram from inside your
network, so there's no port to forward and no VPN to run.

**The bot is read-only.** It answers from the wiki and parks uploads for you. It
never edits a page, moves a document, or commits. Deciding where a document
belongs and whose record it concerns is worth doing with a human in the loop
rather than unattended from a phone.

**Claude only.** The bot shells out to the Claude Code CLI and depends on its
permission model (`--permission-mode dontAsk`, allow/deny rules) for its safety
properties. There is no provider abstraction and no OpenAI/Gemini/Ollama
support. If you want another model, the single place to change is `runClaude()`
in [bot.js](bot.js) — but you'd be re-implementing the sandboxing yourself.

Runs on **macOS, Windows and Linux**.

---

## What you need

| | |
|---|---|
| **Node.js 20.12 or newer** | `node --version` |
| **Claude Code CLI**, signed in | `claude --version` — [install guide](https://claude.com/claude-code). Needs a Claude subscription or an Anthropic API key. |
| **A Telegram account** | on the phone you'll message from |
| **A folder of documents** | or let setup scaffold one from [template/](template/) |

Every message costs a Claude API call or subscription usage. Each one is a fresh
session with a small fixed history window, so the cost per message stays flat —
see [Notes](#notes).

## Quick start

```bash
git clone https://github.com/gonchristopher/homewiki-bot.git
cd homewiki-bot
npm install
npm run setup
```

`npm run setup` walks you through the whole thing: it checks for the Claude CLI,
asks for your bot token, creates a starter wiki from `template/` if you don't
have one, and collects who's allowed to talk to the bot. It writes `.env` and
`users.json` for you and never overwrites an existing file without asking.

Before you run it, get two things from Telegram:

1. **A bot token** — message [`@BotFather`](https://t.me/BotFather), send
   `/newbot`, follow the prompts, copy the token.
2. **Your numeric user ID** — message [`@userinfobot`](https://t.me/userinfobot),
   copy the number it replies with. Do this for each person who should have
   access.

Then start it in the foreground and check it:

```bash
npm start
```

It prints the ID-to-name mapping on startup — **read it**. Message your bot and
send `/whoami` to confirm it identifies you correctly, then confirm a message
from an unlisted Telegram account gets no reply at all. Once that all looks
right, [install it as a service](#keeping-it-running) so it survives a reboot.

<details>
<summary>Manual setup, if you'd rather not use the script</summary>

1. `cp .env.example .env` and fill in `TELEGRAM_BOT_TOKEN` and `HOMEWIKI_PATH`
   (the absolute path to your wiki folder; `~` works).
2. `cp users.example.json users.json` and add an entry per person:
   ```json
   {
     "111111111": {
       "name": "Jane Doe",
       "notes": "Primary wiki owner. See wiki/medical/jane.md for her records."
     }
   }
   ```
   **Double-check these.** A wrong ID-to-name mapping means the bot answers "my
   medical records" with the wrong person's data.
3. If your wiki folder doesn't exist yet, copy `template/` to it.
4. `npm install && npm start`.

</details>

## Setting up your wiki

The bot doesn't store anything itself — it reads a folder you own. That folder
needs a `CLAUDE.md` telling Claude how the household is organized, which is what
[template/](template/) provides:

```
template/
├── CLAUDE.md          -- the instruction manual Claude reads every run
├── raw/               -- original documents (immutable)
├── import/            -- drop folder; where phone uploads land
└── wiki/              -- markdown pages Claude maintains
    ├── index.md  log.md  todos.md  people.md
```

**After copying it, edit `CLAUDE.md`.** Two sections do the real work:

- **"The household"** — names and roles. This is how "my deductible" resolves to
  the right person's records. Keep the names spelled exactly as they appear in
  `users.json`.
- **"Folder structure"** — where new pages go, so filing stays predictable
  instead of drifting into a hundred loose files.

Then drop a handful of documents into `import/`, open Claude Code in the wiki
folder (`claude` from that directory) and say *"process the import folder"*.
It'll file them into `raw/`, write the wiki pages, and build the index. Do a
few rounds at a keyboard before you start asking questions from your phone —
the bot is only as good as the wiki behind it.

Keeping the wiki in git is worth it (`wiki/log.md` plus commit history makes
every filing decision reversible). **Keep that repo private** — it's your
household's documents.

## How it works

- Long-polls the Telegram Bot API — no port forwarding, no VPN, nothing exposed
  on your network. The bot reaches out to Telegram, not the other way around.
- Only responds to Telegram user IDs listed in `users.json`. Everyone else is
  silently ignored.
- Text message → `claude -p` with `cwd` set to your wiki folder. The prompt goes
  in on stdin, never as a command-line argument.
- **Knows who's talking.** `users.json` maps each Telegram ID to a real person,
  injected via `--append-system-prompt`, so "what was my last cholesterol
  reading?" resolves to *that person's* records. Verified: the same question
  from two different users returns two different lipid panels from two different
  wiki pages.
- **Remembers the last 5 exchanges** per person (`MAX_HISTORY` in `bot.js`),
  replayed as a fenced `<recent_conversation>` block.
- Uploaded files/photos → saved into `<wiki>/import/` and nothing else. No Claude
  run, no wiki edit, no commit. The bot replies with the filename it used; you
  run the import workflow yourself later. A caption is saved alongside as
  `<file>.note.txt` so the context survives the wait, and names are de-duplicated
  so a second `scan.pdf` can't clobber the first.
- **Telling it something files a note.** Every message is first classified as a
  question or a statement. A statement becomes
  `import/note-2026-08-13-1712-water-heater-serviced.txt` containing your
  verbatim text, who sent it and when — Claude supplies only the filename slug
  (sanitized to `[a-z0-9-]`, so it can't escape `import/`), and the bot does the
  write with plain `fs`, exactly like an upload. Claude still has no write
  permission. Classification costs no extra run: it happens inside the run the
  message was going to make anyway, and it's deliberately biased toward
  answering — a misfiled question loses its answer, while an answered statement
  costs nothing. `/note` and `/ask` override it either way.
- **Asking for a file gets you a path.** There is no code path that uploads a
  document to Telegram, and the system prompt tells Claude so, which stops it
  apologizing and offering to paste the contents of an unmasked scan instead. It
  searches `raw/` as well as `wiki/` and answers with the path, a line on what
  the file is, and the wiki page covering it.
- Runs **default-deny**: `--permission-mode dontAsk` refuses anything not on an
  explicit allowlist, rather than prompting (which would hang a headless run).
  See [Security](#security).
- Processes one question at a time (a simple in-process queue) so two people
  asking at once don't spawn parallel Claude runs. Uploads skip the queue —
  they're a local file write, so nobody waits behind a long question.
- **Skips questions asked while it was down.** Telegram replays a full offline
  backlog on reconnect; answering it would be both useless and billable. See
  [Cost controls](#cost-controls).
- **Run only one instance.** Nothing enforces this. A second one fights the first
  for Telegram's long-poll (409s, messages landing arbitrarily) and overwrites
  `history.json`, since each process holds it in memory and writes the whole file.

## Commands

- `/note <text>` — file it to `import/` as a note, no classification, no Claude
  run at all
- `/ask <text>` — answer it, even if it reads like a statement. This is the way
  out of a misclassification: resend it as `/ask …`
- `/whoami` — who the bot thinks you are, and how much history it's holding
- `/new` (or `/reset`) — clear this person's conversation history
- `/help` — the above, from your phone

## Cost controls

Every text message spawns a billed Claude run, so anything that can produce
messages faster than a person types is a way to spend money unattended. The
limits are constants at the top of [bot.js](bot.js):

| Guard | Default | What it prevents |
|---|---|---|
| `MAX_MESSAGE_AGE_MS` | 10 min | Answering the offline backlog (below) |
| `CLAUDE_TIMEOUT_MS` | 5 min | A hung run holding the queue and billing forever |
| `MAX_QUEUE_DEPTH` | 5 | A burst of messages queueing unbounded work |
| `MAX_PROMPT_CHARS` | 4000 | One message becoming an enormous prompt |
| `MAX_HISTORY` | 5 exchanges | The replayed context growing without limit |

**The offline backlog is the one that costs real money.** Telegram queues
updates for a bot that's down and delivers all of them on reconnect, up to 24
hours' worth — so a bot that was off overnight would wake up and bill a full
Claude run for every question asked since, answering each one long after anyone
cared. Questions older than `MAX_MESSAGE_AGE_MS` are dropped with a single
notice per chat:

> I was offline when you messaged (180 min ago), so I skipped what came in while
> I was down. Ask again if it still matters. Anything you sent me to file was
> still saved to import/.

**Uploads are exempt from all of this.** They're a local file write that costs
nothing, and a document sent last night is still worth filing this morning — so
queued photos and PDFs still land in `import/` on reconnect.

This also defuses a crash loop. An update Telegram hasn't seen confirmed is
redelivered, so a message that reliably kills the bot would be retried by the
5-minute self-heal every 5 minutes for 24 hours. With the age limit it ages out
after two attempts instead.

What is *not* capped: there's no per-person daily budget, and no ceiling on what
a single run can spend once it starts — an expensive question is bounded only by
`CLAUDE_TIMEOUT_MS`. If you're on API billing rather than a subscription, set a
spend limit in the Anthropic Console as a backstop.

## Keeping it running

Both installers set up a per-user service that starts at login and restarts the
bot if it dies. Neither needs admin rights.

### macOS and Linux

```bash
bash scripts/install-service.sh              # install and start
bash scripts/install-service.sh --uninstall
```

On macOS this writes a **launchd** agent at
`~/Library/LaunchAgents/com.homewiki.bot.plist` with `RunAtLoad` (starts at
login) and `KeepAlive` (restarts it whenever it exits). On Linux it writes a
**systemd user unit** with `Restart=always`.

```bash
launchctl print gui/$(id -u)/com.homewiki.bot          # macOS: status
launchctl kickstart -k gui/$(id -u)/com.homewiki.bot   # macOS: restart
systemctl --user status homewiki-bot                   # Linux: status
systemctl --user restart homewiki-bot                  # Linux: restart
tail -f bot.out.log                                    # either: what it's doing
```

Services start with a minimal `PATH`, which is the usual reason a service-run bot
fails when the same command works in your terminal. If that happens, put
absolute paths in `.env` (`CLAUDE_BIN=/Users/you/.local/bin/claude`) and set
`NODE_BIN` if `node` came from nvm or Homebrew. On Linux, `sudo loginctl
enable-linger $USER` keeps the service up when you're not logged in.

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1
```

That registers a **Scheduled Task** named `homewiki-bot`:

```
schtasks /query /tn homewiki-bot /fo list /v   # check it
schtasks /run   /tn homewiki-bot               # start
schtasks /end   /tn homewiki-bot               # stop
schtasks /delete /tn homewiki-bot /f           # remove
Get-Content bot.out.log -Wait                  # what it's doing
```

Restart after editing `bot.js` or `.env`: `schtasks /end` then `schtasks /run`.
Editing the files alone changes nothing — the running process already has the old
code in memory.

<details>
<summary>Why the Windows task is built the way it is</summary>

- **Trigger 1: at logon, +30s delay.** A cloud-synced wiki folder (OneDrive)
  needs a moment after logon to be ready. This runs in your interactive session,
  so the `claude` CLI can see your credentials in `~/.claude`. The cost is that
  the bot is up only while you're logged in — a reboot that stops at the lock
  screen leaves it down.
- **Action: `wscript.exe` running `run-bot.vbs`.** wscript is a GUI-subsystem
  host and never allocates a console, so nothing appears on screen.
  `powershell -WindowStyle Hidden` does *not* achieve that: Task Scheduler starts
  it as a console app, so the console exists before PowerShell can hide anything.
  That left a black window on the desktop for the life of the bot — not just
  untidy, but a way to kill the bot with a stray Ctrl-C. `run-bot.vbs` waits for
  the launcher, which is load bearing (see `IgnoreNew` below). `run-bot.cmd` does
  the actual launch and log redirection — redirecting from PowerShell 5.1 instead
  would write the logs as UTF-16.
- **Trigger 2: a `Once` trigger repeating every 5 minutes, indefinitely.** This
  is the self-heal, and it must be its own trigger. Hanging the repetition off
  the logon trigger looks right and silently does nothing: a repetition only arms
  when its trigger fires, so until the next logon `NextRunTime` stays empty and
  nothing re-checks. Verified — with the repetition on the logon trigger a killed
  bot was still dead 5.5 minutes later; as its own trigger it came back in under 5.
- **`MultipleInstances=IgnoreNew`.** What makes the repetition safe. While the
  bot is alive a firing is a no-op; if it died, the firing starts it. Worst-case
  downtime is 5 minutes.

Two things that look like they should work and don't, so they don't get retried:
Task Scheduler's built-in **"restart on failure"** never fired (the task ends
with result 1 when the bot is killed and just sits at `Ready`), and a
**repetition attached to the logon trigger** never arms, as above. If
`Next Run Time` is blank in `schtasks /query /v`, the self-heal is not scheduled.

</details>

## Updating

```bash
git pull
npm install          # only strictly needed when package.json changed
```

**Then restart the bot.** Nothing picks up changes on its own — the running
process already has the old code in memory, and every service manager here is
configured to keep it alive rather than notice a new commit.

```bash
launchctl kickstart -k gui/$(id -u)/com.homewiki.bot   # macOS
systemctl --user restart homewiki-bot                  # Linux
```

```powershell
schtasks /end /tn homewiki-bot ; schtasks /run /tn homewiki-bot   # Windows
```

Then send `/whoami` to confirm it came back up. If it doesn't answer, check
`bot.err.log` — a bad `.env` value or a missing dependency shows up there, and
the service will otherwise sit in a quiet restart loop.

Your configuration survives a pull untouched: `.env`, `users.json` and
`history.json` are gitignored, so they're never in a commit and can't conflict.
The one thing to re-read after an update is [.env.example](.env.example) — if a
release adds a setting, that's where it'll be documented, and your existing
`.env` won't have it.

**Updates do not reach your wiki.** `template/` is copied once, at setup — your
wiki folder is your own thereafter, and improvements to the template's
`CLAUDE.md` never propagate to it. That's deliberate: yours has your household
in it and shouldn't be overwritten. To pick up a change, diff them and copy
across by hand:

```bash
diff template/CLAUDE.md "$HOMEWIKI_PATH/CLAUDE.md"
```

If you keep your wiki in git (worth doing), commit before merging anything in,
so a bad edit to the instructions Claude follows is one `git revert` away.

## Security

The documents this bot processes come from third parties (insurers, labs,
contractors). A PDF can carry text crafted to hijack the model, so the design
assumes **the prompt itself may turn hostile** and constrains what a hijacked
run can do.

**Primary control — default-deny.** `--permission-mode dontAsk` refuses anything
not explicitly allowed. The allowlist in `bot.js` is read-only: `Read`, `Glob`,
`Grep`, `TodoWrite`, and `ls` plus `git status`/`log`/`diff`. There is no general
shell, so the usual injection payloads (`curl`, `node -e`, `powershell`) aren't
available. Verified: reads succeed while `Write`, `Edit`, `rm`, `mv`,
`git commit` and `curl` are all refused.

**File-path rules must be cwd-relative.** Rules built from an absolute Windows
path silently match *nothing* — `C:/x/**`, `//C:/x/**` and `C:\x\**` were all
tested and all fail, so the tool they were meant to permit is refused. An earlier
revision scoped every file tool that way, which granted nothing and made document
import fail outright; it went unnoticed because `Read` is permitted by default,
so its equally-inert rule still appeared to work. Use `**`, which is relative to
`cwd` (your wiki folder) and cannot escape it.

**Don't "fix" permission errors by changing mode.** `acceptEdits` and the default
mode both auto-approve unlisted read-only shell — `whoami` and `cat` of arbitrary
files ran with no permission check under both. In one test only the model's own
judgement stopped a `cat` of a `.env`, which is no control at all when the model
is the thing being hijacked. `dontAsk` is load-bearing.

**Backstop — deny rules.** `DENY_RULES` blocks network tools, interpreters,
`git push`/`remote`, and — to enforce read-only — `Write`, `Edit`, `NotebookEdit`
and the mutating Bash commands. Deny rules and `PreToolUse` hooks are enforced
*even under bypass modes*. Denying the write tools is belt-and-braces (omitting
them from the allowlist already suffices under `dontAsk`), but it matters because
these runs inherit your global `~/.claude/settings.json`: an `allow` rule added
there later would otherwise silently re-grant writes. Deny always wins.

**Path scoping.** `Read`, `Glob` and `Grep` are all scoped to the wiki folder.
Scoping `Glob`/`Grep` matters as much as `Read`: `Grep` returns matching *lines*,
so an unscoped `Grep` can pull content out of files anywhere on the disk. That
was a real hole in an earlier revision — it read a value out of a file outside the
wiki. Verified after the fix: out-of-tree `Read`, `Glob`, `Grep` and `Bash` are
all denied, and a spawned subagent inherits the same restrictions rather than
escaping them.

**Untrusted text never touches a shell.** The prompt is written to the CLI's
stdin rather than passed as an argument, so a message can't be mangled into
arguments.

**Don't launch the CLI with Node's `shell: true` on Windows.** An npm install
puts a `claude.cmd` shim on `PATH`, and Node can't spawn a `.cmd` without a
shell — but `shell: true` concatenates arguments *without escaping*, so cmd.exe
strips the quotes out of `--settings {"permissions":...}` and the CLI receives
`{permissions:{deny:[Write,...]}}`. That isn't valid JSON, so the deny rules —
a security control — silently fail to apply. Verified against a stub `.cmd`.
[claude-cli.js](claude-cli.js) builds the command line and quotes it explicitly
instead; native installs are spawned directly with no shell at all.

**MCP servers are not reachable.** Under `dontAsk`, anything not on the allowlist
is refused, and no `mcp__*` tools are listed. Interactively authenticated servers
(e.g. Gmail/Drive) don't come up in a headless run at all. To use one
deliberately, add its tool names to `ALLOWED_TOOLS`.

**Known gaps** — worth understanding before trusting this with anything sensitive:

- The Telegram whitelist is the only gate on *who* can send work. It does not
  constrain what an injected document can attempt once processing starts.
- Telegram is not end-to-end encrypted for bot chats. Your questions and the
  bot's answers — which may quote medical or financial details — pass through
  Telegram's servers. Instruct Claude to mask identifiers in `CLAUDE.md`
  (the template does), and decide for yourself whether that trade is acceptable.
- Allowed Bash commands are matched by prefix, not by path. Out-of-tree calls
  were denied in testing, but the rules themselves express no path constraint,
  so don't treat that as a hard boundary.
- Anyone who obtains your bot token can message the bot, but still can't get
  answers — they'd also need a whitelisted Telegram user ID. Rotate the token via
  @BotFather if it leaks.
- For an actual guarantee rather than a barrier, run the bot as a dedicated
  low-privilege OS user whose filesystem permissions reach only the wiki. Then
  even a full compromise of the model can't read SSH keys, credentials, or this
  bot's own `.env`.

**Files that stay local.** `.env` (bot token), `users.json` (real names and
Telegram IDs), `history.json` (verbatim excerpts of conversations) and the
`*.log` files are all gitignored. Don't commit them, and don't paste log excerpts
into a public issue without reading them first.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Could not run the Claude Code CLI` | `claude --version` must work in your terminal. If it does, the service just has a different `PATH` — set `CLAUDE_BIN` in `.env` to the full path. |
| Bot never replies, no error | Your Telegram ID isn't in `users.json` (unlisted senders are ignored silently), or the bot isn't running. Check `bot.out.log`. |
| `409 Conflict` in the log | Two instances are polling. Stop the service before running `npm start` by hand. |
| `HOMEWIKI_PATH does not exist` | Path typo, or the folder is on a cloud drive that hadn't synced yet at login. The Windows task delays 30s for this. |
| Answers are vague or say "not in the wiki" | The wiki is thin, not the bot. Ingest more documents at a keyboard and make sure `wiki/index.md` lists them. |
| Answers name the wrong person | Check `/whoami`, then check that the name in `users.json` matches how that person appears in `wiki/people.md`. |
| Upload fails over ~20 MB | Telegram's Bot API caps downloads at 20 MB. Split the PDF or copy it in at the keyboard. |
| "I was offline when you messaged" | Working as intended — the bot was down and skipped the backlog rather than billing for it. Just ask again. |
| "I'm still working through N questions" | The queue-depth guard. Wait for the current answers, or raise `MAX_QUEUE_DEPTH`. |
| "claude ran longer than 5 minutes and was stopped" | A run hit `CLAUDE_TIMEOUT_MS`. Usually a question that made it read half the wiki — ask something narrower. |

## Notes

- `history.json` (created automatically) holds the last `MAX_HISTORY` exchanges
  per person. Each run is otherwise a fresh Claude session, so cost per message
  stays flat no matter how long you've been chatting. An earlier design used
  `--resume`, which replays the entire transcript — one run late in a 197-message
  session was re-sending ~127k tokens.
- Because history is a fixed window rather than a real session, Claude does not
  retain its own tool-call context between messages. It re-reads the wiki each
  time, which is what you want for a document store, but it won't remember a file
  it opened three messages ago unless the reply it gave mentioned it.
- `claude -p` auto-loads any project-level `.mcp.json` in the wiki folder, same as
  an interactive session — but under `dontAsk` you must also add each MCP tool to
  `ALLOWED_TOOLS` in `bot.js` (e.g. `mcp__servername__toolname`), or it's refused.

## License

MIT — see [LICENSE](LICENSE).
