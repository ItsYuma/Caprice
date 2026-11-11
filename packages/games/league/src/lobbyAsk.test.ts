import { expect, test } from "bun:test";

import { parseLobby } from "./lobbyAsk.ts";

test("a lobby sentence becomes one plan", () => {
  expect(parseLobby("find a match, ban zed, and pick ahri")).toEqual({
    queue: true,
    cancel: false,
    accept: false,
    ban: "zed",
    pick: "ahri",
  });
  expect(parseLobby("I'll find a match and pick Kai'Sa")).toEqual({
    queue: true,
    cancel: false,
    accept: false,
    ban: "",
    pick: "kai'sa",
  });
  expect(parseLobby("hey capri, can you ban lee sin")).toEqual({
    queue: false,
    cancel: false,
    accept: false,
    ban: "lee sin",
    pick: "",
  });
  expect(parseLobby("lock in yasuo")).toMatchObject({ pick: "yasuo" });
  expect(parseLobby("select caitlyn")).toMatchObject({ pick: "caitlyn" });
  expect(parseLobby("ban nunu and willump")).toMatchObject({
    ban: "nunu and willump",
  });
  expect(parseLobby("queue up")).toMatchObject({ queue: true });
  expect(parseLobby("start the queue")).toMatchObject({ queue: true });
  expect(parseLobby("search for a game")).toMatchObject({ queue: true });
  expect(parseLobby("accept")).toMatchObject({ accept: true });
  expect(parseLobby("accept the ready check")).toMatchObject({ accept: true });
  expect(parseLobby("cancel the queue")).toEqual({
    queue: false,
    cancel: true,
    accept: false,
    ban: "",
    pick: "",
  });
  expect(parseLobby("stop searching")).toMatchObject({ cancel: true });
  expect(parseLobby("leave the queue")).toMatchObject({ cancel: true });
  expect(parseLobby("please ban zed")).toMatchObject({ ban: "zed" });
});

test("anything else stays a normal turn", () => {
  expect(parseLobby("hello")).toBeUndefined();
  expect(parseLobby("what's the score")).toBeUndefined();
  expect(parseLobby("who should I ban")).toBeUndefined();
  expect(parseLobby("did you ban zed")).toBeUndefined();
  expect(parseLobby("I picked ahri last game")).toBeUndefined();
  expect(parseLobby("banter is fun")).toBeUndefined();
  expect(parseLobby("pick me up")).toBeUndefined();
  expect(parseLobby("lock the door")).toBeUndefined();
  expect(parseLobby("accept that")).toBeUndefined();
  expect(parseLobby("find a match and tell me a joke")).toBeUndefined();
  expect(parseLobby("cancel the queue and pick ahri")).toBeUndefined();
  expect(parseLobby("can we ban zed")).toBeUndefined();
});
