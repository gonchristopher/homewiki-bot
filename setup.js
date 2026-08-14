#!/usr/bin/env node
// Interactive first-run setup: writes .env and users.json, and can scaffold a
// starter wiki from template/. Safe to re-run -- it never overwrites an
// existing file without asking.
//
//   npm run setup

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const { probeClaude } = require('./claude-cli');

const REPO = __dirname;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const isWin = process.platform === 'win32';

function expandPath(p) {
  let out = p.trim().replace(/^["']|["']$/g, '');
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) {
    out = path.join(os.homedir(), out.slice(1));
  }
  return path.resolve(out);
}

async function ask(question, fallback = '') {
  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || fallback;
}

async function confirm(question, defaultYes = true) {
  const answer = (await rl.question(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'}: `))
    .trim()
    .toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith('y');
}

function heading(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

async function main() {
  console.log('\n  homewiki-bot setup\n  ------------------');

  // --- 1. Claude Code CLI --------------------------------------------------
  heading('1. Claude Code CLI');
  let claudeBin = 'claude';
  let version = probeClaude(claudeBin);
  // An npm install puts a `claude.cmd` shim on PATH instead of a native binary.
  if (version === null && isWin) {
    version = probeClaude('claude.cmd');
    if (version !== null) claudeBin = 'claude.cmd';
  }
  if (version === null) {
    console.log('  `claude` is not on your PATH.');
    console.log('  Install it from https://claude.com/claude-code, or give the full path now.');
    claudeBin = expandPath(
      await ask(
        '  Full path to the claude binary',
        isWin
          ? path.join(os.homedir(), '.local', 'bin', 'claude.exe')
          : path.join(os.homedir(), '.local', 'bin', 'claude')
      )
    );
    version = probeClaude(claudeBin);
    if (version === null) {
      console.log('  Still could not run it. Setup will continue; fix CLAUDE_BIN in .env later.');
    }
  }
  if (version) console.log(`  Found: ${version}`);
  console.log('  Note: this bot only supports Claude. It shells out to the Claude Code CLI,');
  console.log('  which needs a Claude subscription or an Anthropic API key already signed in.');

  // --- 2. Telegram bot token ----------------------------------------------
  heading('2. Telegram bot token');
  console.log('  Message @BotFather on Telegram, send /newbot, and copy the token it gives you.');
  let token = '';
  while (!token) {
    token = await ask('  Bot token');
    if (!/^\d{6,}:[\w-]{30,}$/.test(token)) {
      console.log("  That doesn't look like a bot token (should be like 123456789:AA...). ");
      const keep = await confirm('  Use it anyway?', false);
      if (!keep) token = '';
    }
  }

  // --- 3. The wiki folder --------------------------------------------------
  heading('3. Your wiki folder');
  console.log('  The folder the bot runs Claude Code inside -- your documents and notes.');
  const defaultWiki = path.join(os.homedir(), 'HomeWiki');
  const wikiPath = expandPath(await ask('  Path to the wiki', defaultWiki));

  if (!fs.existsSync(wikiPath)) {
    console.log(`  ${wikiPath} does not exist.`);
    if (await confirm('  Create it from the starter template in template/?')) {
      fs.cpSync(path.join(REPO, 'template'), wikiPath, { recursive: true });
      console.log(`  Created ${wikiPath} from template/.`);
      console.log('  Edit its CLAUDE.md to describe your household before you start using it.');
    } else {
      console.log('  Skipped. Create the folder yourself before starting the bot.');
    }
  } else if (!fs.existsSync(path.join(wikiPath, 'CLAUDE.md'))) {
    console.log('  That folder exists but has no CLAUDE.md (the instructions Claude follows).');
    if (await confirm('  Copy the starter template into it?')) {
      fs.cpSync(path.join(REPO, 'template'), wikiPath, { recursive: true, force: false });
      console.log('  Copied. Existing files were left alone.');
    }
  } else {
    console.log('  Found an existing CLAUDE.md -- leaving the folder untouched.');
  }
  fs.mkdirSync(path.join(wikiPath, 'import'), { recursive: true });

  // --- 4. Who may talk to the bot -----------------------------------------
  heading('4. Who may talk to the bot');
  console.log('  Message @userinfobot on Telegram to get a numeric user ID.');
  console.log('  Anyone not listed here is silently ignored. Add at least yourself.');
  const users = {};
  for (;;) {
    const id = await ask(`  Telegram user ID${Object.keys(users).length ? ' (blank to finish)' : ''}`);
    if (!id) {
      if (Object.keys(users).length) break;
      console.log('  Add at least one person.');
      continue;
    }
    if (!/^\d+$/.test(id)) {
      console.log('  IDs are numeric -- that looks like a username. Use @userinfobot to get the ID.');
      continue;
    }
    const name = await ask('    Their full name');
    if (!name) {
      console.log('    A name is required -- it is how the bot resolves "my" in a question.');
      continue;
    }
    const notes = await ask('    Notes about them (optional, e.g. "spouse; co-owner of the house")');
    users[id] = notes ? { name, notes } : { name };
    console.log(`    Added ${name}.`);
  }

  // --- 5. Write the files --------------------------------------------------
  heading('5. Writing config');
  const envPath = path.join(REPO, '.env');
  const usersPath = path.join(REPO, 'users.json');

  const envBody =
    `# Written by \`npm run setup\`. See .env.example for what each value means.\n` +
    `TELEGRAM_BOT_TOKEN=${token}\n` +
    `HOMEWIKI_PATH=${wikiPath}\n` +
    `CLAUDE_BIN=${claudeBin}\n`;

  for (const [file, body] of [
    [envPath, envBody],
    [usersPath, JSON.stringify(users, null, 2) + '\n'],
  ]) {
    const rel = path.basename(file);
    if (fs.existsSync(file) && !(await confirm(`  ${rel} already exists. Overwrite it?`, false))) {
      console.log(`  Left ${rel} alone.`);
      continue;
    }
    fs.writeFileSync(file, body);
    console.log(`  Wrote ${rel}.`);
  }
  console.log('  Both files hold secrets and personal data -- .gitignore already excludes them.');

  // --- Done ----------------------------------------------------------------
  heading('Done. Next:');
  console.log('  1. npm start            -- run it in the foreground and check the ID-to-name list');
  console.log('  2. Message your bot on Telegram and send /whoami');
  console.log('  3. Confirm a message from an unlisted account gets no reply');
  console.log(
    `  4. Keep it running: ${
      isWin
        ? 'powershell -ExecutionPolicy Bypass -File scripts\\install-service.ps1'
        : 'bash scripts/install-service.sh'
    }\n`
  );
}

main()
  .catch((err) => {
    console.error(`\nSetup failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
