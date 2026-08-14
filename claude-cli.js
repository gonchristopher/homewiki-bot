// Launching the Claude Code CLI portably.
//
// On macOS and Linux `claude` is a native binary or a shebang script, and
// `spawn` runs it directly. On Windows it may instead be an npm shim
// (`claude.cmd`), which Node refuses to spawn without a shell -- and
// `shell: true` is NOT a usable answer here: Node concatenates the arguments
// without escaping, so cmd.exe eats the quotes in `--settings {"permissions":
// ...}` and the CLI receives `{permissions:{deny:[Write,...]}}`. That is not
// valid JSON, so the deny rules -- a security control -- would silently fail to
// apply. Verified against a stub .cmd.
//
// So for a .cmd/.bat we build the command line ourselves and hand it to cmd.exe
// with `windowsVerbatimArguments`, quoting each argument the way
// CommandLineToArgvW expects.

const { spawn, spawnSync } = require('child_process');

const isShim = (bin) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);

// Standard Windows argument quoting: double any backslash run that precedes a
// quote (or the closing quote), and escape embedded quotes.
function quoteWindowsArg(arg) {
  return `"${String(arg)
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, '$1$1')}"`;
}

// Returns [command, args, extraOptions] ready to hand to spawn/spawnSync.
function launchArgs(bin, args) {
  if (!isShim(bin)) return [bin, args, {}];

  const line = [bin, ...args].map(quoteWindowsArg).join(' ');
  // `/d` skips AutoRun scripts, `/s` makes cmd strip exactly the outer quote
  // pair and treat the rest verbatim.
  return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    windowsVerbatimArguments: true,
  }];
}

function spawnClaude(bin, args, options = {}) {
  const [cmd, cmdArgs, extra] = launchArgs(bin, args);
  // On POSIX, give the run its own process group so a timeout can kill the
  // whole tree rather than just the process we can see (see killTree).
  const group = process.platform === 'win32' ? {} : { detached: true };
  return spawn(cmd, cmdArgs, { ...options, ...group, ...extra });
}

// Runs `claude --version`. Returns the version string, or null if it couldn't
// be run at all.
function probeClaude(bin) {
  const [cmd, cmdArgs, extra] = launchArgs(bin, ['--version']);
  const probe = spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...extra });
  if (probe.error || probe.status !== 0) return null;
  return (probe.stdout || '').trim();
}

// Kills a run and everything it started. `child.kill()` alone is not enough:
// on Windows a .cmd shim means the direct child is cmd.exe, and killing it
// orphans the actual claude process, which would keep working (and billing).
// `taskkill /t` walks the tree; on POSIX the negative PID signals the group.
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

module.exports = { spawnClaude, probeClaude, quoteWindowsArg, launchArgs, killTree };
