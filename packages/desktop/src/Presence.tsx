import { useEffect, useRef, useState } from "react";

import { amplitudeAt, subscribePlayback, type Frame } from "./playback.ts";
import {
  bindTalkButton,
  talkChordLabel,
  type TalkHold,
  type TalkPhase,
} from "./talk.ts";

export type PresenceMode = "idle" | "listening" | "thinking" | "speaking";

export type PresenceProps = {
  phase: TalkPhase;
  hold: TalkHold | undefined;
  hint: string;
};

export function Presence(props: PresenceProps) {
  const figure = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const frame = useRef<Frame>(resting());
  const [speaking, setSpeaking] = useState(false);
  const mode = presenceMode(props.phase, speaking);

  useEffect(() => {
    return subscribePlayback((next) => {
      frame.current = next;
      setSpeaking((current) => (current === next.live ? current : next.live));
    });
  }, []);

  useEffect(() => {
    const node = button.current;

    if (node === null || props.hold === undefined) {
      return;
    }

    return bindTalkButton(node, props.hold);
  }, [props.hold]);

  useEffect(() => {
    let frameId = 0;

    const tick = (now: number) => {
      paintPresence(figure.current, canvas.current, frame.current, mode, now);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [mode]);

  return (
    <div className="presence" data-mode={mode}>
      <button
        ref={button}
        id="talk"
        type="button"
        data-phase={props.phase}
        aria-label="Hold to talk"
        aria-keyshortcuts={talkChordLabel()}
        title={props.hint}
      >
        <div ref={figure} className="figure">
          <svg
            viewBox="0 0 200 236"
            width="200"
            height="236"
            aria-hidden="true"
          >
            <defs>
              <mask
                id="presence-housing"
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="200"
                height="236"
              >
                <rect width="200" height="236" fill="black" />
                <rect
                  x="34"
                  y="20"
                  width="132"
                  height="196"
                  rx="46"
                  fill="white"
                />
              </mask>
            </defs>
            <g mask="url(#presence-housing)">
              <rect
                className="housing"
                x="34"
                y="20"
                width="132"
                height="196"
                rx="46"
              />
              <g className="slit">
                <rect x="58" y="92" width="84" height="10" rx="5" />
              </g>
            </g>
            <circle className="pip" cx="130" cy="174" r="7" />
          </svg>
        </div>
      </button>
      <p id="thinking" data-on={mode === "thinking" ? "true" : "false"}>
        {mode === "thinking" ? "thinking" : ""}
      </p>
      <canvas ref={canvas} className="wave" aria-hidden="true" />
    </div>
  );
}

export function presenceMode(
  phase: TalkPhase,
  speaking: boolean,
): PresenceMode {
  if (speaking) {
    return "speaking";
  }

  if (phase === "listening") {
    return "listening";
  }

  if (phase === "busy") {
    return "thinking";
  }

  return "idle";
}

export function wavePhase(mode: PresenceMode, now: number): number {
  if (prefersStill()) {
    return 0;
  }

  const pace =
    mode === "speaking"
      ? 140
      : mode === "listening"
        ? 220
        : mode === "thinking"
          ? 640
          : 1100;

  return now / pace;
}

export function sineAmplitude(mode: PresenceMode, frame: Frame): number {
  if (mode === "speaking") {
    return amplitudeAt(frame.samples, frame.rate, frame.heard);
  }

  if (mode === "listening") {
    return 0.42;
  }

  if (mode === "thinking") {
    return 0.18;
  }

  return 0.07;
}

export function sineOffset(
  width: number,
  x: number,
  phase: number,
  reach: number,
): number {
  if (!(width > 0)) {
    return 0;
  }

  return Math.sin((x / width) * Math.PI * 2 * 2.5 + phase) * reach;
}

export type WavePen = {
  clearRect: (x: number, y: number, width: number, height: number) => void;
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  stroke: () => void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
};

export function drawWave(
  context: WavePen,
  width: number,
  height: number,
  mode: PresenceMode,
  amplitude: number,
  phase: number,
): void {
  if (width < 2 || height < 2) {
    return;
  }

  context.clearRect(0, 0, width, height);
  const mid = height / 2;
  const level = amplitude > 1 ? 1 : amplitude < 0 ? 0 : amplitude;
  const reach = mid * 0.82 * level;
  const steps = width > 240 ? 240 : Math.floor(width);

  context.lineWidth = Math.max(2, Math.round(height / 28));
  context.lineCap = "round";
  context.strokeStyle = waveColor(mode);
  context.beginPath();

  for (let step = 0; step <= steps; step += 1) {
    const x = (step * (width - 1)) / steps;
    const y = mid + sineOffset(width, x, phase, reach);

    if (step === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();
}

function waveColor(mode: PresenceMode): string {
  if (mode === "speaking") {
    return "#f2a2c8";
  }

  if (mode === "thinking") {
    return "#e38bb8";
  }

  if (mode === "listening") {
    return "#ffd0e4";
  }

  return "#a88898";
}

function resting(): Frame {
  return {
    live: false,
    samples: new Float32Array(),
    rate: 0,
    heard: 0,
  };
}

function paintPresence(
  figure: HTMLDivElement | null,
  canvas: HTMLCanvasElement | null,
  frame: Frame,
  mode: PresenceMode,
  now: number,
): void {
  const amplitude = sineAmplitude(mode, frame);

  if (figure !== null) {
    figure.style.setProperty("--amp", amplitude.toFixed(4));
    figure.dataset.live = mode === "speaking" ? "true" : "false";
    figure.dataset.mode = mode;
  }

  if (canvas === null) {
    return;
  }

  const context = canvas.getContext("2d");

  if (context === null) {
    return;
  }

  const size = bitmapSize(canvas);
  drawWave(
    context,
    size.width,
    size.height,
    mode,
    amplitude,
    wavePhase(mode, now),
  );
}

function bitmapSize(canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const measuredWidth = Math.round(bounds.width * scale);
  const measuredHeight = Math.round(bounds.height * scale);
  const width = measuredWidth >= 2 ? measuredWidth : canvas.width;
  const height = measuredHeight >= 2 ? measuredHeight : canvas.height;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return { width, height };
}

function prefersStill(): boolean {
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  return media !== undefined && media.matches;
}
