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
  problem: string;
  credit: string;
};

export function Presence(props: PresenceProps) {
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
      paintPresence(canvas.current, frame.current, mode, now);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [mode]);

  return (
    <button
      ref={button}
      id="talk"
      type="button"
      data-phase={props.phase}
      data-mode={mode}
      aria-label="Hold to talk"
      aria-keyshortcuts={talkChordLabel()}
      title={props.hint}
    >
      <div className="hud">
        <div className="hud-chamfer-box">
          <div className="hud-chamfer-box-inner">
            <div className="hud-copy">
              <p className="tag">
                <span>&gt; capri:</span>
                {mode === "thinking" ? (
                  <span className="processing">[PROCESSING...]</span>
                ) : null}
                {mode === "listening" ? (
                  <span className="listen">[LISTENING...]</span>
                ) : null}
              </p>
              {mode === "thinking" ? <Thinking /> : null}
              {mode === "speaking" ? (
                <canvas ref={canvas} className="wave" aria-hidden="true" />
              ) : null}
              {props.problem.length > 0 ? (
                <p id="problem">{props.problem}</p>
              ) : null}
              {props.credit.length > 0 ? (
                <p id="voice-credit">{props.credit}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function Thinking() {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const frames = [".", "..", "..."];
    let index = 0;

    const timer = setInterval(() => {
      index = (index + 1) % frames.length;
      setDots(frames[index] ?? ".");
    }, 350);

    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <p className="line">
      <span id="thinking">thinking</span>
      <span className="dots">{dots}</span>
      <span className="caret" />
    </p>
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
  if (mode === "idle") {
    return "#5c6b7a";
  }

  return "#00f0ff";
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
  canvas: HTMLCanvasElement | null,
  frame: Frame,
  mode: PresenceMode,
  now: number,
): void {
  if (canvas === null) {
    return;
  }

  const amplitude = sineAmplitude(mode, frame);

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
