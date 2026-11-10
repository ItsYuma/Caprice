import { expect, test } from "bun:test";

import { openLobby } from "./lobbyDesk.ts";

const summary = JSON.stringify([
  { id: 238, name: "Zed", alias: "Zed" },
  { id: 103, name: "Ahri", alias: "Ahri" },
]);

test("a normal sentence does not call the client", async () => {
  let calls = 0;

  const desk = openLobby(async () => {
    calls += 1;

    return '"Lobby"';
  });

  expect(await desk.hear("what's the score")).toBeUndefined();
  expect(calls).toBe(0);
});

test("the spoken plan queues now and the follower bans on the turn", async () => {
  let phase = "Lobby";
  const seen: string[] = [];
  const cues: string[] = [];
  const stop = new AbortController();
  let sleeps = 0;

  const desk = openLobby(
    async (request) => {
      seen.push(request);

      if (request.startsWith("GET /lol-gameflow")) {
        return JSON.stringify(phase);
      }

      if (request.startsWith("GET /lol-champ-select")) {
        return JSON.stringify({
          localPlayerCellId: 1,
          timer: { phase: "BAN_PICK" },
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

      if (request.startsWith("GET /lol-game-data")) {
        return summary;
      }

      return "{}";
    },
    async () => {
      sleeps += 1;
      phase = "ChampSelect";

      if (sleeps > 4) {
        stop.abort();
      }
    },
  );

  const route = await desk.hear("find a match, ban zed, and pick ahri");

  expect(route?.cue).toContain("Started the queue.");
  expect(route?.cue).toContain("Will ban Zed");
  expect(route?.fallback).toBe("Queue's up. I'll ban Zed and lock Ahri.");
  expect(seen).toContain("POST /lol-lobby/v2/lobby/matchmaking/search");

  await desk.follow(async (cue) => {
    cues.push(cue);
    stop.abort();

    return true;
  }, stop.signal);

  expect(cues.some((cue) => cue.includes("Banned Zed."))).toBe(true);
  expect(seen.some((item) => item.includes('"championId":238'))).toBe(true);
});

test("cancel stops the search", async () => {
  const seen: string[] = [];

  const desk = openLobby(async (request) => {
    seen.push(request);

    return '"Lobby"';
  });

  const route = await desk.hear("cancel the queue");

  expect(route?.cue).toContain("Cancelled the queue.");
  expect(route?.fallback).toBe("Queue's off.");
  expect(seen).toContain("DELETE /lol-lobby/v2/lobby/matchmaking/search");
});
