import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { drawWave, type WavePen } from "./Presence.tsx";
import type { Frame } from "./playback.ts";
import { CapricePage } from "./CapricePage.tsx";
import { ShowText } from "./ShowText.tsx";

const lines = [
  { who: "host" as const, text: "pine" },
  { who: "capri" as const, text: "cedar" },
] as const;

test("show text starts closed", () => {
  const html = renderToStaticMarkup(<ShowText lines={lines} />);

  expect(html).toContain(">Show text<");
  expect(html).toContain('aria-pressed="false"');
  expect(html).not.toContain("data-who");
  expect(html).not.toContain("pine");
  expect(html).not.toContain("cedar");
});

test("a closed control renders no lines and the problem stays outside", () => {
  const html = renderToStaticMarkup(
    <CapricePage
      lines={lines}
      problem="the model request failed"
      hold={undefined}
      talkPhase="idle"
      talkHint=""
      talkStatus=""
      credit=""
      onSubmit={() => false}
    />,
  );

  const showAt = html.indexOf('class="show-text"');
  const problemAt = html.indexOf('id="problem"');

  expect(html).toContain('aria-pressed="false"');
  expect(html).not.toContain("data-who");
  expect(html).not.toContain("pine");
  expect(html).not.toContain("cedar");
  expect(html).toContain("the model request failed");
  expect(showAt).toBeGreaterThan(-1);
  expect(problemAt).toBeGreaterThan(showAt);
  expect(html.indexOf("</div>", showAt)).toBeLessThan(problemAt);
});

test("the woof credit stays outside the transcript", () => {
  const html = renderToStaticMarkup(
    <CapricePage
      lines={lines}
      problem=""
      hold={undefined}
      talkPhase="idle"
      talkHint=""
      talkStatus=""
      credit="Voice by Underdog Woof"
      onSubmit={() => false}
    />,
  );

  expect(html).toContain('id="voice-credit"');
  expect(html).toContain("Voice by Underdog Woof");
  expect(html).not.toContain("data-who");
});

test("the wave is one line until speech, then the heard prefix is brighter", () => {
  const idle = marks();

  drawWave(idle.pen, 4, 10, {
    live: false,
    samples: new Float32Array([1]),
    rate: 1000,
    heard: 1,
  });
  expect(idle.strokes).toEqual(["#a88898"]);
  expect(idle.fills).toEqual([]);

  const live = marks();

  drawWave(live.pen, 4, 10, heardFrame(0.5));
  expect(live.fills).toEqual(["#f2a2c8", "#4a3340"]);
  expect(live.strokes).toEqual(["#f2a2c8", "#6d4d5c"]);
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
  const fills: string[] = [];
  const strokes: string[] = [];

  const pen: WavePen = {
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      fills.push(String(pen.fillStyle));
    },
    stroke() {
      strokes.push(String(pen.strokeStyle));
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
  };

  return { pen, fills, strokes };
}
