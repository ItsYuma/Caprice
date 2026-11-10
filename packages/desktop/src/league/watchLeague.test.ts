import { expect, test } from "bun:test";

import { followLeague, followMatch, remarkGapMs } from "./watchLeague.ts";

test("followLeague polls until the window stops", async () => {
  const stop = new AbortController();
  let polls = 0;

  await followLeague(async () => {
    polls += 1;
    stop.abort();

    return "";
  })(async () => false, stop.signal);

  expect(polls).toBe(1);
});

test("a second fact waits out the gap", async () => {
  let clock = 0;
  let polls = 0;
  const cues: string[] = [];
  const stop = new AbortController();

  await followMatch(
    async () => {
      polls += 1;

      if (polls === 1) {
        return payload(8, [start(0)]);
      }

      if (polls === 2) {
        return payload(20, [start(0), kill(1, "Draven")]);
      }

      if (polls === 3) {
        clock += remarkGapMs;

        return payload(40, [start(0), kill(1, "Draven"), kill(2, "Garen")]);
      }

      stop.abort();

      return payload(40, [start(0), kill(1, "Draven"), kill(2, "Garen")]);
    },
    async (cue) => {
      cues.push(cue);

      return true;
    },
    stop.signal,
    async (ms) => {
      clock += ms;
    },
    () => clock,
  );

  expect(cues).toHaveLength(2);
  expect(cues[0]).toContain("The match started");
  expect(cues[1]).toContain("You killed Garen");
  expect(cues.join("\n").includes("Your team lost")).toBe(false);
});

test("a dropped client is silence, then the next game can start", async () => {
  let polls = 0;
  const cues: string[] = [];
  const stop = new AbortController();

  await followMatch(
    async () => {
      polls += 1;

      if (polls === 1) {
        return payload(8, [start(0)]);
      }

      if (polls < 6) {
        throw new Error("closed");
      }

      if (polls === 6) {
        return payload(6, [start(0, 1)]);
      }

      stop.abort();

      return payload(6, [start(0, 1)]);
    },
    async (cue) => {
      cues.push(cue);

      return true;
    },
    stop.signal,
    async () => {},
    () => polls * 20_000,
  );

  expect(cues).toHaveLength(2);
  expect(cues[0]).toContain("You are playing Ahri");
  expect(cues[1]).toContain("You are playing Ahri");
  expect(cues.join("\n").includes("Your team lost")).toBe(false);
  expect(cues.join("\n").includes("Your team won")).toBe(false);
});

function payload(
  gameTime: number,
  events: readonly Record<string, string | number>[],
): string {
  return JSON.stringify({
    activePlayer: { summonerName: "Ada" },
    allPlayers: [
      {
        championName: "Ahri",
        summonerName: "Ada",
        team: "ORDER",
        position: "MIDDLE",
        level: 4,
        scores: { kills: 1, deaths: 0, assists: 0, creepScore: 20 },
      },
      {
        championName: "Garen",
        summonerName: "Garen",
        team: "CHAOS",
        position: "TOP",
      },
      {
        championName: "Draven",
        summonerName: "Draven",
        team: "CHAOS",
        position: "BOTTOM",
      },
    ],
    events: { Events: events },
    gameData: { gameMode: "CLASSIC", gameTime, mapNumber: 11 },
  });
}

function start(id: number, time = 0.2) {
  return { EventID: id, EventName: "GameStart", EventTime: time };
}

function kill(id: number, victim: string) {
  return {
    EventID: id,
    EventName: "ChampionKill",
    EventTime: 15,
    KillerName: "Ada",
    VictimName: victim,
  };
}
