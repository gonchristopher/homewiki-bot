// Windows argument quoting, which is a security control rather than a cosmetic
// one: `--settings {"permissions":{"deny":[...]}}` has to arrive at the CLI as
// valid JSON, or the deny rules silently fail to apply.

const test = require('node:test');
const assert = require('node:assert');

const { quoteWindowsArg, launchArgs } = require('../claude-cli');

// CommandLineToArgvW, in JS: the parser Windows programs are handed their
// argv by. Round-tripping through it is the only honest check that our quoting
// is right.
function parseWindowsCommandLine(line) {
  const argv = [];
  let arg = '';
  let inQuotes = false;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') {
      let slashes = 0;
      while (line[i] === '\\') {
        slashes++;
        i++;
      }
      if (line[i] === '"') {
        arg += '\\'.repeat(slashes >> 1);
        if (slashes % 2) {
          arg += '"';
        } else {
          inQuotes = !inQuotes;
        }
        started = true;
      } else {
        arg += '\\'.repeat(slashes);
        i--;
      }
      continue;
    }
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        arg += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      started = true;
      continue;
    }
    if (!inQuotes && (c === ' ' || c === '\t')) {
      if (started || arg) argv.push(arg);
      arg = '';
      started = false;
      continue;
    }
    arg += c;
    started = true;
  }
  if (started || arg) argv.push(arg);
  return argv;
}

const CASES = [
  'plain',
  'with spaces',
  '--allowedTools',
  'Bash(git status:*)',
  JSON.stringify({ permissions: { deny: ['Write', 'Edit', 'Bash(curl:*)'] } }),
  'trailing backslash\\',
  'two backslashes\\\\',
  'quote " inside',
  'backslash before quote \\"',
  'C:\\Users\\someone\\HomeWiki',
  '',
];

test('quoted arguments survive the Windows command-line parser unchanged', () => {
  for (const arg of CASES) {
    const round = parseWindowsCommandLine(quoteWindowsArg(arg));
    assert.deepEqual(round, [arg], `mangled: ${JSON.stringify(arg)}`);
  }
});

test('a whole command line round-trips, --settings JSON included', () => {
  const argv = [
    'C:\\Program Files\\nodejs\\claude.cmd',
    '-p',
    '--permission-mode',
    'dontAsk',
    '--settings',
    JSON.stringify({ permissions: { deny: ['Write', 'Edit', 'NotebookEdit'] } }),
  ];
  const line = argv.map(quoteWindowsArg).join(' ');
  const parsed = parseWindowsCommandLine(line);
  assert.deepEqual(parsed, argv);
  // The point of all this: the JSON is still JSON on the other side.
  assert.deepEqual(JSON.parse(parsed[5]).permissions.deny, ['Write', 'Edit', 'NotebookEdit']);
});

test('launchArgs never asks for a shell', () => {
  for (const bin of ['claude', 'claude.cmd', '/usr/local/bin/claude', 'C:\\x\\claude.CMD']) {
    const [, , extra] = launchArgs(bin, ['-p']);
    assert.equal('shell' in extra, false, `shell requested for ${bin}`);
  }
});

test('a non-shim binary is spawned directly', () => {
  const bin = process.platform === 'win32' ? 'claude.exe' : 'claude';
  assert.deepEqual(launchArgs(bin, ['-p', '--verbose']), [bin, ['-p', '--verbose'], {}]);
});

test('a .cmd shim goes through cmd.exe verbatim, quoted by us', { skip: process.platform !== 'win32' }, () => {
  const [cmd, args, extra] = launchArgs('claude.cmd', ['--settings', '{"a":1}']);
  assert.match(cmd.toLowerCase(), /cmd\.exe$/);
  assert.deepEqual(args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(extra.windowsVerbatimArguments, true);
  // cmd /s strips exactly the outer pair, leaving our own quoting intact.
  const inner = args[3].replace(/^"|"$/g, '');
  assert.deepEqual(parseWindowsCommandLine(inner), ['claude.cmd', '--settings', '{"a":1}']);
});
