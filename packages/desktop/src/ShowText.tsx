import type { Line } from "@caprice/core";
import { useState } from "react";

import { Log } from "./Log.tsx";

export type ShowTextProps = {
  lines: readonly Line[];
};

export function ShowText(props: ShowTextProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="show-text">
      <button
        type="button"
        aria-pressed={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        Show text
      </button>
      {open ? <Log lines={props.lines} /> : null}
    </div>
  );
}
