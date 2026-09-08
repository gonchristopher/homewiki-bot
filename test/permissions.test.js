// The permission config is the control that keeps a hijacked prompt (a hostile
// PDF telling the model to run something) from doing damage. Each assertion
// here corresponds to a line in the README's Security section that a future
// change must not quietly relax.

const test = require('node:test');
const assert = require('node:assert');

const { ALLOWED_TOOLS, DENY_RULES, CLAUDE_PERMISSION_ARGS } = require('../lib/permissions');

test('the run is default-deny', () => {
  const i = CLAUDE_PERMISSION_ARGS.indexOf('--permission-mode');
  assert.notEqual(i, -1, '--permission-mode is missing');
  assert.equal(
    CLAUDE_PERMISSION_ARGS[i + 1],
    'dontAsk',
    'only dontAsk refuses unlisted tools; acceptEdits and the default mode auto-approve ' +
      'unlisted read-only shell'
  );
  assert.equal(CLAUDE_PERMISSION_ARGS.includes('--dangerously-skip-permissions'), false);
});

test('the deny rules reach the CLI as parseable JSON', () => {
  const i = CLAUDE_PERMISSION_ARGS.indexOf('--settings');
  assert.notEqual(i, -1, '--settings is missing');
  const settings = JSON.parse(CLAUDE_PERMISSION_ARGS[i + 1]);
  assert.deepEqual(settings.permissions.deny, DENY_RULES);
});

test('the bot stays read-only even if a global settings file allows writes', () => {
  // These runs inherit ~/.claude/settings.json, where an allow rule could
  // re-grant writes. Deny wins, so the deny list is what actually holds.
  for (const tool of ['Write', 'Edit', 'NotebookEdit']) {
    assert.ok(DENY_RULES.includes(tool), `${tool} must be denied outright`);
    assert.equal(ALLOWED_TOOLS.includes(tool), false, `${tool} must not be allowed`);
  }
});

test('no exfiltration channel is allowed', () => {
  for (const tool of ['WebFetch', 'WebSearch']) {
    assert.ok(DENY_RULES.includes(tool), `${tool} must be denied`);
  }
  for (const cmd of ['curl', 'wget', 'nc', 'ssh', 'scp', 'git push', 'git remote']) {
    assert.ok(DENY_RULES.includes(`Bash(${cmd}:*)`), `Bash(${cmd}:*) must be denied`);
  }
});

test('no interpreter is allowed, so injection cannot re-open arbitrary execution', () => {
  for (const cmd of ['node', 'python', 'python3', 'npm', 'npx', 'bash', 'sh', 'powershell', 'cmd']) {
    assert.ok(DENY_RULES.includes(`Bash(${cmd}:*)`), `Bash(${cmd}:*) must be denied`);
  }
});

test('file tools are cwd-relative globs, never absolute paths', () => {
  // An absolute path in a rule -- in any spelling -- silently matches nothing,
  // so the tool it was meant to permit ends up refused. cwd is HOMEWIKI_PATH,
  // so `**` is already scoped to the wiki.
  for (const rule of ALLOWED_TOOLS) {
    const arg = (rule.match(/^\w+\((.*)\)$/) || [])[1];
    if (!arg || rule.startsWith('Bash(')) continue;
    assert.doesNotMatch(arg, /^(\/|[A-Za-z]:|\\\\)/, `absolute path in rule: ${rule}`);
  }
});

test('Glob and Grep stay path-scoped', () => {
  // Grep returns matching *lines*, so unscoped it is an exfiltration primitive
  // every bit as capable as Read.
  for (const tool of ['Glob', 'Grep', 'Read']) {
    assert.equal(ALLOWED_TOOLS.includes(tool), false, `${tool} must not be allowed unscoped`);
    assert.ok(
      ALLOWED_TOOLS.some((r) => r.startsWith(`${tool}(`)),
      `${tool} must be allowed only in its scoped form`
    );
  }
});

test('no general shell is granted', () => {
  assert.equal(ALLOWED_TOOLS.includes('Bash'), false);
  for (const rule of ALLOWED_TOOLS.filter((r) => r.startsWith('Bash('))) {
    // Every Bash grant names a specific read-only command.
    assert.match(rule, /^Bash\((ls|git status|git log|git diff):\*\)$/, `broad shell grant: ${rule}`);
  }
});

test('every allowlist entry is a bare tool name or a scoped rule', () => {
  for (const rule of ALLOWED_TOOLS) {
    assert.match(rule, /^[A-Za-z_][\w]*(\(.*\))?$/, `malformed allow rule: ${rule}`);
  }
  for (const rule of DENY_RULES) {
    assert.match(rule, /^[A-Za-z_][\w]*(\(.*\))?$/, `malformed deny rule: ${rule}`);
  }
});
