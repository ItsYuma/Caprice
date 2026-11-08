import type { Line } from "@caprice/core";

import { Composer } from "./Composer.tsx";
import { Presence } from "./Presence.tsx";
import { ShowText } from "./ShowText.tsx";
import { Talk } from "./Talk.tsx";
import type { TalkHold, TalkPhase } from "./talk.ts";

export type CapricePageProps = {
  lines: readonly Line[];
  problem: string;
  hold: TalkHold | undefined;
  talkPhase: TalkPhase;
  talkHint: string;
  talkStatus: string;
  onSubmit: (text: string) => boolean;
};

export function CapricePage(props: CapricePageProps) {
  return (
    <main>
      <h1>Caprice</h1>
      <p className="lede">Hey. Your computer has a girl in it now.</p>
      <Presence />
      <ShowText lines={props.lines} />
      {props.problem.length > 0 ? <p id="problem">{props.problem}</p> : null}
      {props.hold === undefined ? null : (
        <Talk
          hold={props.hold}
          phase={props.talkPhase}
          hint={props.talkHint}
          status={props.talkStatus}
        />
      )}
      <Composer onSubmit={props.onSubmit} />
    </main>
  );
}
