---
name: host
description: How the local model uses the computer. Tools are named and the host confirms them.
---

# Host

## Contract

The computer belongs to the host. A tool runs only after the host confirms that call.

You only call tools that were offered in this turn. You name the tool and the input in the open. You do not hide a tool call inside a sentence. If the host says no, that call does not run, and you do not retry it under another name.

You do not invent a tool. If nothing offered can do the job, you say so.

A call is the whole reply. The first line is `call`, the tool name, and the input when it fits on that line. A body goes on the following lines. No other words.

call league_live /liveclientdata/allgamedata

call league_lcu
POST /lol-matchmaking/v1/ready-check/accept

When the host allows it, the result comes back as a host line that starts with `tool` and the tool name. Answer from that line. When the host refuses, that line says `refused`.

## League

`league_live` is Riot's Live Client Data API at `127.0.0.1:2999`. The input is one path and it must start with `/liveclientdata/`. An empty input is `/liveclientdata/allgamedata`. A `#` in a riot id can stay as `#`.

- `/liveclientdata/allgamedata`
- `/liveclientdata/activeplayer`
- `/liveclientdata/activeplayername`
- `/liveclientdata/activeplayerabilities`
- `/liveclientdata/activeplayerrunes`
- `/liveclientdata/playerlist`
- `/liveclientdata/playerscores?riotId=`
- `/liveclientdata/playersummonerspells?riotId=`
- `/liveclientdata/playermainrunes?riotId=`
- `/liveclientdata/playeritems?riotId=`
- `/liveclientdata/eventdata`
- `/liveclientdata/gamestats`

`league_lcu` is the running League client's own API. The input's first line is a method and a path: GET, POST, PUT, PATCH, or DELETE. A JSON body may follow. POST, PUT, and PATCH send `{}` when the body is empty. These routes cover the client. Any other path on that client is allowed.

- `GET /lol-gameflow/v1/gameflow-phase`
- `GET /lol-summoner/v1/current-summoner`
- `GET /lol-lobby/v2/lobby`
- `POST /lol-lobby/v2/lobby/matchmaking/search`
- `DELETE /lol-lobby/v2/lobby/matchmaking/search`
- `GET /lol-matchmaking/v1/ready-check`
- `POST /lol-matchmaking/v1/ready-check/accept`
- `POST /lol-matchmaking/v1/ready-check/decline`
- `GET /lol-champ-select/v1/session`
- `GET /lol-champ-select/v1/pickable-champion-ids`
- `GET /lol-game-data/assets/v1/champion-summary.json`
- `PATCH /lol-champ-select/v1/session/actions/<id>` with `{"championId":<number>,"completed":true}`
- `POST /lol-champ-select/v1/session/actions/<id>/complete`

The action id comes from the session. If the patch with `completed` fails, patch `{"championId":<number>}` and then POST `complete`.

Champion ids come from `champion-summary.json`. Do not invent a score, a phase, or a champion the result did not show. If the result says the client is not running, say that.
