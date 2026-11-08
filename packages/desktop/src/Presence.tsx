import { useEffect, useRef } from "react";

import {
  amplitudeAt,
  subscribePlayback,
  waveColumns,
  type Frame,
} from "./playback.ts";

export function Presence() {
  const figure = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<Frame>(resting());

  useEffect(() => {
    paintPresence(figure.current, canvas.current, frame.current);
  });

  useEffect(() => {
    return subscribePlayback((next) => {
      frame.current = next;
      paintPresence(figure.current, canvas.current, next);
    });
  }, []);

  return (
    <div className="presence">
      <div ref={figure} className="figure">
        <svg
          viewBox="0 0 200 236"
          width="200"
          height="236"
          role="img"
          aria-label="Caprice"
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
      <canvas ref={canvas} className="wave" aria-hidden="true" />
    </div>
  );
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
): void {
  if (figure !== null) {
    const amp = amplitudeAt(frame.samples, frame.rate, frame.heard);
    figure.style.setProperty("--amp", amp.toFixed(4));
    figure.dataset.live = frame.live ? "true" : "false";
  }

  if (canvas === null) {
    return;
  }

  const context = canvas.getContext("2d");

  if (context === null) {
    return;
  }

  const size = bitmapSize(canvas);
  drawWave(context, size.width, size.height, frame);
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

export type WavePen = {
  clearRect: (x: number, y: number, width: number, height: number) => void;
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  closePath: () => void;
  fill: () => void;
  stroke: () => void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
};

export function drawWave(
  context: WavePen,
  width: number,
  height: number,
  frame: Frame,
): void {
  if (width < 2 || height < 2) {
    return;
  }

  context.clearRect(0, 0, width, height);
  const mid = height / 2;
  context.lineWidth = Math.max(2, Math.round(height / 56));
  context.lineCap = "butt";

  if (!frame.live || frame.samples.length === 0) {
    strokeSpan(context, 0, width, "#a88898", mid);

    return;
  }

  const columns = waveColumns(frame.samples, width);
  const heard = Math.min(width, Math.max(0, Math.round(frame.heard * width)));
  const reach = mid * 0.86;
  fillSpan(context, columns, 0, heard, "#f2a2c8", mid, reach);
  fillSpan(context, columns, heard, width, "#4a3340", mid, reach);
  strokeSpan(context, 0, heard, "#f2a2c8", mid);
  strokeSpan(context, heard, width, "#6d4d5c", mid);
}

function fillSpan(
  context: WavePen,
  columns: Float32Array,
  from: number,
  to: number,
  color: string,
  mid: number,
  reach: number,
): void {
  if (to <= from) {
    return;
  }

  const last = to - 1;

  context.fillStyle = color;
  context.beginPath();
  context.moveTo(from, mid - (columns[from] ?? 0) * reach);

  for (let x = from + 1; x <= last; x += 1) {
    context.lineTo(x, mid - (columns[x] ?? 0) * reach);
  }

  context.lineTo(last, mid + (columns[last] ?? 0) * reach);

  for (let x = last - 1; x >= from; x -= 1) {
    context.lineTo(x, mid + (columns[x] ?? 0) * reach);
  }

  context.closePath();
  context.fill();
}

function strokeSpan(
  context: WavePen,
  from: number,
  to: number,
  color: string,
  mid: number,
): void {
  if (to <= from) {
    return;
  }

  context.strokeStyle = color;
  context.beginPath();
  context.moveTo(from, mid);
  context.lineTo(to, mid);
  context.stroke();
}
