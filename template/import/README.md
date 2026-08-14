# import/

Drop folder. Put new documents here — scan them, drag them in, or send them to
the Telegram bot from your phone — then tell Claude **"process the import
folder"**.

Claude will read each file, file the important ones into `raw/` under a clear
name, update the wiki pages they affect, and leave this folder empty again (this
README stays).

Two kinds of `.txt` show up here from the bot, and they aren't the same thing:

- `<something>.note.txt` — the caption that came with a Telegram upload. Context
  for whoever files the document; delete it once the document is filed.
- `note-YYYY-MM-DD-HHMM-<subject>.txt` — something a household member *told* the
  bot in chat ("the water heater was serviced today"). There's no document
  behind it, so it can't be filed into `raw/`: fold the fact into the wiki page
  that owns the subject, cite it as reported by that person on that date, and
  delete the note.

Nothing in here is a source of truth until it has been filed into `raw/`.
