import { expect, test } from "bun:test";

import { confirmKind, pendingLabel, readToolCall } from "./call.ts";

test("a call is the whole reply", () => {
  expect(readToolCall("call league_live /liveclientdata/allgamedata")).toEqual({
    name: "league_live",
    input: "/liveclientdata/allgamedata",
  });
  expect(
    readToolCall(
      'call league_lcu\nPATCH /lol-champ-select/v1/session/actions/3\n{"championId":103,"completed":true}',
    ),
  ).toEqual({
    name: "league_lcu",
    input:
      'PATCH /lol-champ-select/v1/session/actions/3\n{"championId":103,"completed":true}',
  });
  expect(readToolCall("call league_live")).toEqual({
    name: "league_live",
    input: "",
  });
});

test("a sentence is not a call", () => {
  expect(
    readToolCall("I can call league_live /liveclientdata/allgamedata"),
  ).toBeUndefined();
  expect(
    readToolCall("Call league_live /liveclientdata/allgamedata"),
  ).toBeUndefined();
  expect(readToolCall("call me later")).toEqual({
    name: "me",
    input: "later",
  });
});

test("yes and no are the confirmation, and anything else is another turn", () => {
  expect(confirmKind(" Yes ")).toBe("allow");
  expect(confirmKind("sí")).toBe("allow");
  expect(confirmKind("oui")).toBe("allow");
  expect(confirmKind("no")).toBe("refuse");
  expect(confirmKind("don't")).toBe("refuse");
  expect(confirmKind("non")).toBe("refuse");
  expect(confirmKind("what's the score")).toBe("talk");
  expect(confirmKind("yes please")).toBe("talk");
});

test("the box names the call without the whole body", () => {
  const label = pendingLabel({
    name: "league_lcu",
    input: `PATCH /lol-champ-select/v1/session/actions/3\n${"x".repeat(80)}`,
  });

  expect(label.startsWith("league_lcu PATCH")).toBe(true);
  expect(label.endsWith("…")).toBe(true);
  expect(label.length).toBeLessThan(90);
  expect(pendingLabel({ name: "league_live", input: "" })).toBe("league_live");
});
