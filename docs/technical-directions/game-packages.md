# Game packages

Games live in `packages/games/*` and implement `@caprice/games`. Desktop loads a game only when detection finds it or `enabledGames` lists it. League is that kind of package, so the shell can run with no game installed and another game does not have to sit inside desktop.

Set aside: League types inside the desktop package, and core importing a game.
