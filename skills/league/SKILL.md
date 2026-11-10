---
name: league
description: How Caprice plays League with the offered client tools.
---

# League

## Play

`league_live` reads the live game. `league_lcu` reads and changes the League client. The offered tool text lists the routes. Follow it.

The host's request is the authorization. Pick Yasuo when they say to pick Yasuo. Accept the ready check when they say to accept it. Do the reads you need, then the action. Do not ask them to confirm.

Champion ids come from `champion-summary.json`. The action id comes from the champ select session. If a patch with `completed` fails, patch `{"championId":<number>}` and then POST `complete`. Do not invent a score, a phase, or a champion the result did not show. If the result says the client is not running, say that.

A `#` in a riot id can stay as `#`.

A host line that starts with "Live match." is the live game, already read. Answer in one short spoken line from that line alone. Do not call a tool for it. Do not invent a kill, a score, or an objective it did not state.
