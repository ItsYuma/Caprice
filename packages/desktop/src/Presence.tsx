import { useEffect, useRef, useState, type ReactNode } from "react";

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

  const open = mode !== "idle" || props.problem.length > 0;

  return (
    <div className="presence" data-mode={mode}>
      {open ? (
        <Hud mode={mode} problem={props.problem}>
          {mode === "speaking" ? (
            <canvas ref={canvas} className="wave" aria-hidden="true" />
          ) : null}
        </Hud>
      ) : null}
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
          <Figure />
        </div>
      </button>
    </div>
  );
}

function Figure() {
  return (
    <svg viewBox="0 0 200 340" width="200" height="340" aria-hidden="true">
      <path
        className="hair"
        d="M62 118c0-62 28-92 70-92 36 0 58 28 54 64-6 8-20 10-32 6 8 14 6 32-6 42-22-6-40-6-54-2-16-6-32-10-32-18z"
      />
      <path
        className="streak"
        d="M146 40c18 10 24 28 14 44-12-8-18-22-14-44z"
      />
      <ellipse className="face" cx="100" cy="112" rx="30" ry="34" />
      <circle className="eye" cx="90" cy="110" r="4.5" />
      <circle className="eye" cx="114" cy="110" r="4.5" />
      <path className="body" d="M72 152h56l12 86H60z" />
      <path className="panel" d="M86 166h28l3 40H83z" />
      <path className="mark" d="M130 172h8l5 26h-8z" />
      <path className="leg" d="M74 238h20l-2 78H68z" />
      <path className="leg" d="M106 238h20l6 78h-22z" />
    </svg>
  );
}

function Hud(props: {
  mode: PresenceMode;
  problem: string;
  children: ReactNode;
}) {
  const named = props.mode === "thinking" || props.mode === "speaking";

  return (
    <div className="hud">
      <div className="hud-chamfer-box">
        <div className="hud-chamfer-box-inner">
          <div className="hud-copy">
            {props.mode === "listening" ? (
              <p className="listen">[LISTENING...]</p>
            ) : null}
            {named ? (
              <p className="tag">
                <span>&gt; capri:</span>
                {props.mode === "thinking" ? (
                  <span className="processing">[PROCESSING...]</span>
                ) : null}
              </p>
            ) : null}
            {props.mode === "thinking" ? <Thinking /> : null}
            {props.children}
            {props.problem.length > 0 ? (
              <p id="problem">{props.problem}</p>
            ) : null}
          </div>
        </div>
      </div>
      <svg className="tail" viewBox="0 0 20 12" aria-hidden="true">
        <polygon
          points="1,0 6,11 18,0"
          fill="#080a12"
          stroke="#00f0ff"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
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
