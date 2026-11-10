# League client APIs

Caprice uses the local Live Client Data API and League client API. Each integration supplies executable tools and descriptions together. General calling rules remain in `skills/host`; League behavior is in `skills/league`. Core receives the registered tools and knows nothing about League.

`league_live` reads HTTPS on `127.0.0.1:2999`. Its path starts with `/liveclientdata/`; empty input means `/liveclientdata/allgamedata`. Query values support Unicode and spaces. Valid percent escapes are preserved, and a Riot ID's `#` is encoded rather than treated as a fragment.

`league_lcu` reads the port and token from the running client or its lockfile. An explicit `CAPRICE_LEAGUE_LOCKFILE` wins before process discovery; an invalid override is an error. Windows discovery drains PowerShell output while waiting with a deadline. Discovery runs on the blocking pool. The model never receives the token.

An LCU request is a method and path followed by an optional JSON body. GET, POST, PUT, PATCH, and DELETE are supported. The host's request authorizes its necessary actions without a second confirmation. Game state and champion IDs come from the API. Cancellation prevents subsequent calls; it cannot roll back a request already accepted by the client.

Transport accepts only a parsed loopback URL with an explicit port. The local certificate exception is restricted to that transport. Redirects, proxies, and automatic retries are disabled. Responses have a four-second deadline and are read up to 4,000,000 bytes rather than fully buffered before truncation. The assistant applies a smaller context budget before retaining tool output.

`league.rs` is the facade. `games/discover.rs`, `games/request.rs`, and `games/transport.rs` own discovery, parsing, and HTTP respectively. These modules currently implement League; other integrations get their own implementation instead of extending a universal request tool.

Set aside: the Riot developer API, starting League, bundled champion tables, a plugin loader, and an agent framework solely for these calls. Typed tool events allow native function calling without tying game transport to a model provider.
