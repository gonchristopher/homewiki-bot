// Guards that can only be checked against the source itself. They exist because
// each one, once relaxed, fails silently: nothing errors, the bot keeps
// answering, and the control is simply gone. CI is the only place that notices.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// Comments in this codebase spell out the mistakes not to make, so a scan for a
// forbidden construct has to look at code only.
const code = (f) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
const SOURCES = ['bot.js', 'claude-cli.js', 'setup.js', 'lib/text.js', 'lib/permissions.js'];

test('every source file parses', () => {
  for (const f of SOURCES) {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f} does not parse:\n${r.stderr}`);
  }
});

test('the CLI is never spawned with a shell', () => {
  // `shell: true` makes Node concatenate arguments unescaped; cmd.exe then eats
  // the quotes in `--settings {json}` and the deny rules silently fail to apply.
  for (const f of SOURCES) {
    assert.doesNotMatch(code(f), /shell\s*:\s*true/, `${f} spawns with a shell`);
  }
});

test('the prompt goes to the CLI on stdin, not in argv', () => {
  const src = read('bot.js');
  assert.match(src, /child\.stdin\.end\(prompt\)/, 'the prompt is no longer written to stdin');
  // The only argv the run gets is flags plus the permission config.
  assert.doesNotMatch(src, /args\.push\(\s*prompt/, 'the prompt is being pushed into argv');
});

test('the permission config reaches every run', () => {
  assert.match(read('bot.js'), /\.\.\.CLAUDE_PERMISSION_ARGS/, 'a run without the permission args');
});

test('raw error text never goes to a chat', () => {
  // err.message from a library can carry absolute paths, stderr, or the API URL
  // with the bot token embedded in it. Chats get chatSafeMessage() instead.
  const src = read('bot.js');
  const calls = src.match(/sendMessage\([^;]*?\)/gs) || [];
  for (const call of calls) {
    assert.doesNotMatch(call, /\berr(or)?\.message\b/, `raw error text sent to a chat:\n${call}`);
  }
  assert.match(src, /function chatSafeMessage/);
});

test('the note marker is matched against the whole reply', () => {
  // A wiki document is untrusted input and could contain the marker; a
  // substring match would let an echoed copy swallow the answer.
  const src = read('bot.js');
  const re = (src.match(/const NOTE_REPLY_RE = new RegExp\(`(.*)`\);/) || [])[1];
  assert.ok(re, 'NOTE_REPLY_RE is gone or has changed shape');
  assert.ok(re.startsWith('^') && re.endsWith('$'), `NOTE_REPLY_RE is not anchored: ${re}`);
});

test('the cost guards are still in place', () => {
  const src = read('bot.js');
  for (const guard of [
    'MAX_MESSAGE_AGE_MS',
    'CLAUDE_TIMEOUT_MS',
    'MAX_QUEUE_DEPTH',
    'MAX_PROMPT_CHARS',
    'MAX_HISTORY',
    'MAX_CONCURRENT_UPLOADS',
  ]) {
    assert.match(src, new RegExp(`const ${guard} = `), `${guard} was removed`);
  }
});

test('secrets are not committed', () => {
  const tracked = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).stdout || '';
  const files = tracked.split('\n').filter(Boolean);
  for (const f of files) {
    assert.doesNotMatch(
      f,
      /^(\.env|users\.json|groups\.json|history\.json|sessions\.json)$|\.log$|^logs\//,
      `${f} holds private data and must stay untracked`
    );
  }
  // A Telegram bot token, wherever it might have been pasted.
  for (const f of files.filter((n) => /\.(js|json|md|sh|cmd|ps1|vbs|yml|yaml|example)$/.test(n))) {
    const body = read(f);
    assert.doesNotMatch(body.replace(/1234567890:ABC[\w-]*/g, ''), /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, `${f} looks like it contains a bot token`);
  }
});

test('bot.js refuses to start without configuration', { skip: fs.existsSync(path.join(ROOT, '.env')) && 'a local .env would be loaded' }, () => {
  const env = { ...process.env };
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.HOMEWIKI_PATH;
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bot.js')], {
    encoding: 'utf8',
    env,
    timeout: 30000,
  });
  assert.notEqual(r.status, 0, 'started with no token -- it would poll Telegram unauthenticated');
  assert.match(r.stderr, /TELEGRAM_BOT_TOKEN is not set/);
});
