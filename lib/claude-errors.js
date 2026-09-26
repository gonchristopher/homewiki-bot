// Turning a failed `claude -p` run into something the person in the chat can
// act on. Pure: a function of the run's stdout and stderr, so it is testable
// without a CLI.
//
// Neither stream can go to the chat as-is (see reportable() in bot.js): stderr
// can carry absolute paths, and stdout is wiki content that never passed the
// masking rules. So this only *recognises* a failure and answers with one of
// the fixed lines below -- nothing from the run is ever echoed. The worst a
// hostile document can do by quoting "please run /login" is make a failed run
// report the wrong cause; the detail still goes to the log either way.

const FAILURES = [
  {
    // "Invalid API key · Please run /login", "Not logged in", an expired OAuth
    // token, or the raw 401 from the API.
    re: /run \/login|not logged in|invalid api key|oauth token (has )?expired|authentication_error|api error: 401/i,
    message:
      "Claude isn't logged in on the bot's machine (or its login expired). " +
      'Run `claude` there, use /login, then ask again.',
  },
  {
    re: /credit balance is too low|insufficient.?credit/i,
    message: 'The Anthropic account behind the bot is out of credit.',
  },
  {
    re: /usage limit|rate.?limit|api error: 429/i,
    message: "Claude's usage limit has been reached. Try again later.",
  },
  {
    re: /overloaded|api error: 5\d\d|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i,
    message: "Couldn't reach Claude's API just now. Try again in a few minutes.",
  },
];

// Only look at the parts of stdout that describe the failure. With
// `--output-format json` an API failure still prints a result object, flagged
// `is_error`, whose `result` is the error text. Anything else on stdout is
// treated as content and not scanned.
function failureText(stdout, stderr) {
  const parts = [String(stderr || '')];
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && parsed.is_error && typeof parsed.result === 'string') parts.push(parsed.result);
  } catch {
    /* not JSON: leave stdout out */
  }
  return parts.join('\n');
}

// Returns a fixed, chat-safe line describing the failure, or null if it isn't
// one we recognise.
function diagnoseClaudeFailure(stdout, stderr) {
  const text = failureText(stdout, stderr);
  const hit = FAILURES.find((f) => f.re.test(text));
  return hit ? hit.message : null;
}

module.exports = { diagnoseClaudeFailure };
