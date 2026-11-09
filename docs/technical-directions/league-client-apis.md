# League client APIs

Caprice calls the same two local League APIs as CapriDesktop, and nothing around them.

`league_live` is Riot's Live Client Data API. It is HTTPS on `127.0.0.1:2999`, and every path starts with `/liveclientdata/`. Empty input is `/liveclientdata/allgamedata`. The other documented paths are `activeplayer`, `activeplayername`, `activeplayerabilities`, `activeplayerrunes`, `playerlist`, `playerscores`, `playersummonerspells`, `playermainrunes`, `playeritems`, `eventdata`, and `gamestats`.

`league_lcu` is the League client's own API. The port and the password come from the running client's command line, then from its lockfile. On Windows that command line is `LeagueClientUx.exe`. Lockfile candidates are the product install path, plus `Riot Games\League of Legends`, `Games\Riot Games\League of Legends`, and `Program Files\Riot Games\League of Legends` on `C` through `H`. `CAPRICE_LEAGUE_LOCKFILE` wins when it is set. The request is `METHOD /path` plus an optional JSON body. GET, POST, PUT, PATCH, and DELETE are allowed. POST, PUT, and PATCH send `{}` when the body is empty. The routes the model is shown are gameflow, the current summoner, the lobby, matchmaking search, the ready check and its accept and decline, champion select, pickable champion ids, completing a champion-select action, and `champion-summary.json`. Any other path on that client is allowed. Champion ids come from that summary. There is no copied champion list.

Both stay on `127.0.0.1`. Rust sends them. The page cannot accept the client's certificate. The token is not returned to the model. A body over 4_000_000 bytes is cut. She runs the call herself. A turn stops after four calls, and then she answers in words.

The model sees the routes in `skills/host`, after the voice. A call is the whole reply, `call` and the tool name. The chat body stays `{ model, messages }`. The result comes back as a host line. She answers from that.

Set aside: Mastra or any other agent framework, a `tools` field on the chat body, the Riot developer API at `api.riotgames.com`, starting League through RiotClientServices, the commentary and item-advice copy, the spoken-command parser, and a bundled champion table. CapriDesktop does not use Mastra. The session already owns the turn. Starting the game opens a process. It is not one of these two APIs.
