import { expect, test } from "bun:test";

import { personaText } from "./persona.ts";

const skill = await Bun.file(
  new URL("../../../skills/capri/SKILL.md", import.meta.url),
).text();

const host = await Bun.file(
  new URL("../../../skills/host/SKILL.md", import.meta.url),
).text();

test("capri skill feeds the model from the voice heading", () => {
  const persona = personaText(skill);

  expect(persona.startsWith("## Voice")).toBe(true);
  expect(persona).toContain("bored");
  expect(persona).toContain("cheerful");
  expect(persona).toContain("mock");
  expect(persona).toContain("fun");
});

test("host skill states the confirmation rule", () => {
  expect(host).toContain("## Contract");
  expect(host).toContain("confirm");
});

test("personaText rejects a skill with no voice", () => {
  expect(() => personaText("# Capri\nnope")).toThrow("Voice");
});
