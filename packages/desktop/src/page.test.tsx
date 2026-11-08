import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CapricePage } from "./CapricePage.tsx";
import {
  drawWave,
  presenceMode,
  sineAmplitude,
  sineOffset,
  type WavePen,
} from "./Presence.tsx";
import type { Frame } from "./playback.ts";

test("the window is the box and hides the conversation", () => {
  const html = renderToStaticMarkup(
    <CapricePage
      problem="the model request failed"
      hold={undefined}
      talkPhase="idle"
      hint="Hold Alt+Space or Ctrl+Space. Release to send."
      credit="Voice by Underdog Woof"
      pace=""
      step=""
      stepAt={0}
    />,
  );

  expect(html).toContain(
    'title="Hold Alt+Space or Ctrl+Space. Release to send."',
  );
  expect(html).toContain('aria-keyshortcuts="Alt+Space Control+Space"');
  expect(html).toContain('aria-label="Hold to talk"');
  expect(html).toContain('aria-label="Close"');
  expect(html).toContain("data-tauri-drag-region");
  expect(html).toContain("hud-chamfer-box");
  expect(html).toContain('id="problem"');
  expect(html).toContain("the model request failed");
  expect(html).toContain("Voice by Underdog Woof");
  expect(html).toContain("&gt; capri:");
  expect(html).not.toContain('id="thinking"');
  expect(html).not.toContain("hair");
  expect(html).not.toContain("Show text");
  expect(html).not.toContain("Say something");
  expect(html).not.toContain("data-who");
});

test("thinking is the only line while she works", () => {
  const html = renderToStaticMarkup(
    <CapricePage
      problem=""
      hold={undefined}
      talkPhase="busy"
      hint=""
      credit=""
      pace=""
      step=""
      stepAt={0}
    />,
  );

  expect(html).toContain("hud-chamfer-box");
  expect(html).toContain("&gt; capri:");
  expect(html).toContain("[PROCESSING...]");
  expect(html).toContain(">thinking<");
  expect(presenceMode("busy", false)).toBe("thinking");
  expect(presenceMode("busy", true)).toBe("speaking");
  expect(presenceMode("listening", false)).toBe("listening");
  expect(presenceMode("idle", false)).toBe("idle");
});

test("the box shows where the turn spent time", () => {
  const html = renderToStaticMarkup(
    <CapricePage
      problem=""
      hold={undefined}
      talkPhase="busy"
      hint=""
      credit=""
      pace="hear 1.4s · reply 400ms"
      step="voice"
      stepAt={0}
    />,
  );

  expect(html).toContain("[VOICE...]");
  expect(html).toContain('id="thinking">voice<');
  expect(html).toContain('id="pace"');
  expect(html).toContain("hear 1.4s · reply 400ms");
  expect(html).not.toContain("hello");
});

test("the sine follows the moment being spoken", () => {
  const loud = Math.abs(sineOffset(100, 10, Math.PI / 2, 20));
  const quiet = Math.abs(sineOffset(100, 10, Math.PI / 2, 4));

  expect(loud).toBeGreaterThan(quiet);
  expect(sineAmplitude("speaking", heardFrame(0.5))).toBeGreaterThan(0);
  expect(sineAmplitude("idle", heardFrame(1))).toBeLessThan(
    sineAmplitude("speaking", heardFrame(0.5)),
  );

  const speaking = marks();

  drawWave(speaking.pen, 80, 24, "speaking", 0.8, 0.4);
  expect(speaking.drawn.strokes).toEqual(["#00f0ff"]);
  expect(speaking.drawn.moves).toBe(1);
  expect(speaking.drawn.lines).toBeGreaterThan(8);

  const idle = marks();

  drawWave(idle.pen, 80, 24, "idle", 0.07, 0);
  expect(idle.drawn.strokes).toEqual(["#5c6b7a"]);
});

function heardFrame(heard: number): Frame {
  return {
    live: true,
    samples: new Float32Array([1, -1, 0.25, -0.25]),
    rate: 1000,
    heard,
  };
}

function marks() {
  const strokes: string[] = [];

  const drawn = {
    moves: 0,
    lines: 0,
    strokes,
  };

  const pen: WavePen = {
    clearRect() {},
    beginPath() {},
    moveTo() {
      drawn.moves += 1;
    },
    lineTo() {
      drawn.lines += 1;
    },
    stroke() {
      drawn.strokes.push(String(pen.strokeStyle));
    },
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "round",
  };

  return { pen, drawn };
}
