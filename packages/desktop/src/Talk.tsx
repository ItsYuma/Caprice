import { useEffect, useRef } from "react";

import {
  bindTalkButton,
  talkChordLabel,
  type TalkHold,
  type TalkPhase,
} from "./talk.ts";

export type TalkProps = {
  hold: TalkHold;
  phase: TalkPhase;
  hint: string;
  status: string;
};

export function Talk(props: TalkProps) {
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const node = button.current;

    if (node === null) {
      return;
    }

    return bindTalkButton(node, props.hold);
  }, [props.hold]);

  return (
    <div className="talk">
      <button
        ref={button}
        id="talk"
        type="button"
        data-phase={props.phase}
        aria-keyshortcuts={talkChordLabel()}
      >
        Hold to talk
      </button>
      <p id="talk-hint" className="hint">
        {props.hint}
      </p>
      <p id="talk-status" className="status">
        {props.status}
      </p>
    </div>
  );
}
