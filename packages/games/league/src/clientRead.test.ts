import { expect, test } from "bun:test";

import {
  actionKindPresent,
  findChampion,
  openAction,
  parseChampions,
  parseChampSelect,
  parsePhase,
  parseReadyCheck,
} from "./clientRead.ts";

const summary = JSON.stringify([
  { id: 238, name: "Zed", alias: "Zed" },
  { id: 103, name: "Ahri", alias: "Ahri" },
  { id: 64, name: "Lee Sin", alias: "LeeSin" },
  { id: 145, name: "Kai'Sa", alias: "Kaisa" },
  { id: 62, name: "Wukong", alias: "MonkeyKing" },
  { id: 20, name: "Nunu & Willump", alias: "Nunu" },
  { id: 254, name: "Vi", alias: "Vi" },
  { id: 21, name: "Miss Fortune", alias: "MissFortune" },
  { id: 54, name: "Malphite", alias: "Malphite" },
  { id: 90, name: "Malzahar", alias: "Malzahar" },
]);

test("phase and ready check read the client body", () => {
  expect(parsePhase('"Lobby"')).toBe("Lobby");
  expect(parsePhase("ReadyCheck")).toBe("ReadyCheck");
  expect(parsePhase("")).toBeUndefined();
  expect(parsePhase("Lobby/../x")).toBeUndefined();
  expect(
    parseReadyCheck('{"state":"InProgress","playerResponse":"None"}'),
  ).toEqual({ state: "InProgress", response: "None" });
  expect(parseReadyCheck("nope")).toBeUndefined();
});

test("champion names resolve from the live summary", () => {
  const champions = parseChampions(summary);

  expect(findChampion(champions, "zed")?.id).toBe(238);
  expect(findChampion(champions, "kai'sa")?.name).toBe("Kai'Sa");
  expect(findChampion(champions, "kaisa")?.name).toBe("Kai'Sa");
  expect(findChampion(champions, "lee sin")?.name).toBe("Lee Sin");
  expect(findChampion(champions, "lee")?.name).toBe("Lee Sin");
  expect(findChampion(champions, "monkey king")?.name).toBe("Wukong");
  expect(findChampion(champions, "nunu and willump")?.name).toBe(
    "Nunu & Willump",
  );
  expect(findChampion(champions, "vi")?.name).toBe("Vi");
  expect(findChampion(champions, "miss fortune")?.name).toBe("Miss Fortune");
  expect(findChampion(champions, "mal")).toBeUndefined();
  expect(findChampion(champions, "mf")).toBeUndefined();
  expect(parseChampions("nope")).toEqual([]);
});

test("the open action is the local player's current ban or pick", () => {
  const session = parseChampSelect(
    JSON.stringify({
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
          {
            id: 4,
            actorCellId: 2,
            championId: 0,
            type: "pick",
            completed: true,
            isInProgress: false,
          },
        ],
      ],
    }),
  );

  if (session === undefined) {
    throw new Error("session");
  }

  expect(session.phase).toBe("BAN_PICK");
  expect(openAction(session, "ban")?.id).toBe(2);
  expect(openAction(session, "pick")).toBeUndefined();
  expect(actionKindPresent(session, "pick")).toBe(true);
  expect(parseChampSelect("{}")).toBeUndefined();
});
