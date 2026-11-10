import { expect, test } from "bun:test";

import { parseLobby } from "./lobbyAsk.ts";
import {
  applyAsk,
  emptyMemory,
  lobbyMissLimit,
  runLobby,
  type LobbyCall,
  type LobbyMemory,
} from "./lobbyRun.ts";

const summary = JSON.stringify([
  { id: 238, name: "Zed", alias: "Zed" },
  { id: 103, name: "Ahri", alias: "Ahri" },
  { id: 64, name: "Lee Sin", alias: "LeeSin" },
]);

test("search starts in a lobby and a missing lobby is said once", async () => {
  const asked = memoryFor("find a match, ban zed, and pick ahri");
  const seen: string[] = [];

  const started = await runLobby(asked, async (request) => {
    seen.push(request);

    if (request.startsWith("GET /lol-gameflow")) {
      return '"Lobby"';
    }

    return "{}";
  });

  expect(started.fact).toEqual({ kind: "queued", already: false });
  expect(started.memory.plan?.queued).toBe(true);
  expect(started.memory.plan?.ban).toBe("zed");
  expect(seen).toContain("POST /lol-lobby/v2/lobby/matchmaking/search");

  const blocked = await runLobby(asked, async (request) => {
    if (request.startsWith("GET /lol-gameflow")) {
      return '"None"';
    }

    throw new Error("league client returned 404: missing");
  });

  expect(blocked.fact).toEqual({ kind: "no-lobby" });
  expect(blocked.memory.plan?.queue).toBe(false);
  expect(blocked.memory.plan?.ban).toBe("zed");
});

test("accept posts when the ready check is up", async () => {
  const seen: string[] = [];

  const stepped = await runLobby(memoryFor("accept"), async (request) => {
    seen.push(request);

    if (request.startsWith("GET /lol-gameflow")) {
      return '"ReadyCheck"';
    }

    if (request.startsWith("GET /lol-matchmaking")) {
      return '{"state":"InProgress","playerResponse":"None"}';
    }

    return "{}";
  });

  expect(stepped.fact).toEqual({ kind: "accepted" });
  expect(seen).toContain("POST /lol-matchmaking/v1/ready-check/accept");
});

test("a ban locks on the open action and falls back to complete", async () => {
  const seen: string[] = [];

  const stepped = await runLobby(memoryFor("ban zed"), async (request) => {
    seen.push(request);

    if (request.startsWith("GET /lol-gameflow")) {
      return '"ChampSelect"';
    }

    if (request.startsWith("GET /lol-champ-select/v1/session")) {
      return banSession("BAN_PICK");
    }

    if (request.startsWith("GET /lol-game-data")) {
      return summary;
    }

    if (request.includes('"completed":true')) {
      throw new Error("league client returned 500: no");
    }

    return "{}";
  });

  expect(stepped.fact).toEqual({ kind: "banned", name: "Zed" });
  expect(seen.some((item) => item.includes('"completed":true'))).toBe(true);
  expect(
    seen.some(
      (item) => item.startsWith("PATCH") && !item.includes("completed"),
    ),
  ).toBe(true);
  expect(seen.some((item) => item.startsWith("POST"))).toBe(true);
  expect(stepped.memory.plan).toBeUndefined();
});

test("planning and a blind pick do not invent a ban", async () => {
  const planning = await runLobby(memoryFor("ban zed"), async (request) => {
    if (request.startsWith("GET /lol-gameflow")) {
      return '"ChampSelect"';
    }

    if (request.startsWith("GET /lol-game-data")) {
      return summary;
    }

    return banSession("PLANNING");
  });

  expect(planning.fact).toBeUndefined();
  expect(planning.memory.plan?.banDone).toBe(false);

  const blind = await runLobby(
    memoryFor("ban zed and pick ahri"),
    async (request) => {
      if (request.startsWith("GET /lol-gameflow")) {
        return '"ChampSelect"';
      }

      if (request.startsWith("GET /lol-game-data")) {
        return summary;
      }

      return JSON.stringify({
        localPlayerCellId: 1,
        timer: { phase: "BAN_PICK" },
        actions: [
          [
            {
              id: 8,
              actorCellId: 1,
              championId: 0,
              type: "pick",
              completed: false,
              isInProgress: true,
            },
          ],
        ],
      });
    },
  );

  expect(blind.fact).toEqual({ kind: "ban-skipped" });
  expect(blind.memory.plan?.pick).toBe("ahri");

  const picked = await runLobby(blind.memory, async (request) => {
    if (request.startsWith("GET /lol-gameflow")) {
      return '"ChampSelect"';
    }

    if (request.startsWith("GET /lol-game-data")) {
      return summary;
    }

    if (request.startsWith("PATCH")) {
      return "{}";
    }

    return JSON.stringify({
      localPlayerCellId: 1,
      timer: { phase: "BAN_PICK" },
      actions: [
        [
          {
            id: 8,
            actorCellId: 1,
            championId: 0,
            type: "pick",
            completed: false,
            isInProgress: true,
          },
        ],
      ],
    });
  });

  expect(picked.fact).toEqual({ kind: "picked", name: "Ahri" });
});

test("an unknown champion is dropped and a down client clears after the misses", async () => {
  const unknown = await runLobby(memoryFor("ban blorbo"), async (request) => {
    if (request.startsWith("GET /lol-gameflow")) {
      return '"ChampSelect"';
    }

    if (request.startsWith("GET /lol-game-data")) {
      return summary;
    }

    return banSession("BAN_PICK");
  });

  expect(unknown.fact).toEqual({ kind: "ban-unknown", query: "blorbo" });
  expect(unknown.memory.plan).toBeUndefined();

  let memory = memoryFor("pick ahri");

  for (let miss = 0; miss < lobbyMissLimit - 1; miss += 1) {
    const stepped = await runLobby(memory, failing);

    memory = stepped.memory;

    if (miss === 0) {
      expect(stepped.fact).toEqual({ kind: "down" });
    } else {
      expect(stepped.fact).toBeUndefined();
    }

    expect(memory.plan?.pick).toBe("ahri");
  }

  const cleared = await runLobby(memory, failing);

  expect(cleared.fact).toBeUndefined();
  expect(cleared.memory.plan).toBeUndefined();
  expect(cleared.memory.champions).toBeUndefined();
});

test("a match that already started ends the plan", async () => {
  const stepped = await runLobby(
    memoryFor("pick ahri"),
    async () => '"InProgress"',
  );

  expect(stepped.fact).toEqual({ kind: "in-game" });
  expect(stepped.memory.plan).toBeUndefined();

  const again = await runLobby(stepped.memory, async () => '"InProgress"');

  expect(again.fact).toBeUndefined();
});

function memoryFor(text: string): LobbyMemory {
  const ask = parseLobby(text);

  if (ask === undefined) {
    throw new Error(text);
  }

  return applyAsk(emptyMemory(), ask);
}

function banSession(phase: string): string {
  return JSON.stringify({
    localPlayerCellId: 1,
    timer: { phase },
    actions: [
      [
        {
          id: 2,
          actorCellId: 1,
          championId: 0,
          type: "ban",
          completed: false,
          isInProgress: true,
        },
      ],
    ],
  });
}

const failing: LobbyCall = async () => {
  throw new Error("down");
};
