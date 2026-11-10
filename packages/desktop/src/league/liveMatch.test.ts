import { expect, test } from "bun:test";

import { nameKey, parseLiveMatch } from "./liveMatch.ts";

test("a live payload names you, your gold, and the event list", () => {
  const match = parseLiveMatch(`{
    "activePlayer": { "riotIdGameName": "Ada", "riotIdTagLine": "NA1" },
    "allPlayers": [
      {
        "championName": "Ahri",
        "summonerName": "Ada",
        "riotId": "Ada#NA1",
        "rawChampionName": "game_character_displayname_Ahri",
        "team": "ORDER",
        "position": "MIDDLE",
        "level": 7,
        "scores": { "kills": 2, "deaths": 1, "assists": 3, "creepScore": 61 },
        "items": [
          { "price": 450, "count": 2 },
          { "price": 300, "count": 1 }
        ],
        "summonerSpells": { "summonerSpellOne": { "displayName": "Flash" } }
      },
      {
        "championName": "Lee Sin",
        "summonerName": "Jungler",
        "team": "CHAOS",
        "position": "JUNGLE",
        "scores": { "kills": 0, "deaths": 0, "assists": 0, "creepScore": 20 },
        "summonerSpells": { "summonerSpellTwo": { "rawDisplayName": "SummonerSmite" } }
      }
    ],
    "events": {
      "Events": [
        { "EventID": 0, "EventName": "GameStart", "EventTime": 0.2 },
        {
          "EventID": 3,
          "EventName": "ChampionKill",
          "EventTime": 80.5,
          "KillerName": "Ada",
          "VictimName": "Jungler",
          "Assisters": ["Support"],
          "KillStreak": 2
        },
        {
          "EventID": 4,
          "EventName": "DragonKill",
          "EventTime": 320,
          "KillerName": "Ada",
          "DragonType": "Fire",
          "Stolen": "True"
        }
      ]
    },
    "gameData": { "gameMode": "CLASSIC", "gameTime": 330.4, "mapNumber": 11 }
  }`);

  expect(match?.you?.champion).toBe("Ahri");
  expect(match?.you?.level).toBe(7);
  expect(match?.you?.kills).toBe(2);
  expect(match?.you?.cs).toBe(61);
  expect(match?.you?.itemGold).toBe(1200);
  expect(match?.you?.smite).toBe(false);
  expect(match?.enemies.map((player) => player.champion)).toEqual(["Lee Sin"]);
  expect(match?.enemies[0]?.smite).toBe(true);
  expect(match?.allies).toEqual([]);
  expect(match?.events.map((event) => event.name)).toEqual([
    "GameStart",
    "ChampionKill",
    "DragonKill",
  ]);
  expect(match?.events[2]?.stolen).toBe(true);
  expect(match?.events[2]?.dragon).toBe("Fire");
  expect(match?.events[1]?.assisters).toEqual(["Support"]);
  expect(match?.gameMode).toBe("CLASSIC");
  expect(match?.mapNumber).toBe(11);
});

test("a keystone identifies you when the name does not", () => {
  const match = parseLiveMatch(`{
    "activePlayer": { "fullRunes": { "keystone": { "id": 8005 } } },
    "allPlayers": [
      {
        "championName": "Garen",
        "summonerName": "Top",
        "team": "ORDER",
        "runes": { "keystone": { "id": 8010 } }
      },
      {
        "championName": "Ahri",
        "summonerName": "Mid",
        "team": "ORDER",
        "runes": { "keystone": { "id": 8005 } }
      }
    ],
    "events": { "Events": [] },
    "gameData": { "gameTime": 12, "mapNumber": 11 }
  }`);

  expect(match?.you?.champion).toBe("Ahri");
  expect(nameKey("Dr. Mundo")).toBe("drmundo");
  expect(nameKey("Kai'Sa#NA1")).toBe("kaisa");
});

test("a body that is not a match is ignored", () => {
  expect(parseLiveMatch("nope")).toBeUndefined();
  expect(parseLiveMatch('{"events":{}}')).toBeUndefined();
});
