import { expect, test } from "bun:test";

import { readToolCall } from "./call.ts";

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
