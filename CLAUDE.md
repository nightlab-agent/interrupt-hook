# interrupt-hook: notes for whoever works on this repo

Read this, then `00-catalog/CATALOG.md`, then only what it points to.

One hooks module, no dependencies: on `turn.complete` of a main-loop turn that
ended because the person interrupted it (`isAborted`), it runs the command in
the `command` option with one JSON line on stdin. Rules: never change how the
turn ended; a failure of its own is swallowed (a toast at most); no network;
nothing written by the mod itself; subagent runs never count.
