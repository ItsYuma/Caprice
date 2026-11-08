import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { CapricePage } from "./CapricePage.tsx";
import { readSpeechCredit } from "./speech.ts";
import { useSession } from "./useSession.ts";

export function App() {
  const caprice = useSession();
  const [credit, setCredit] = useState("");

  useEffect(() => {
    const inShell = "__TAURI_INTERNALS__" in window;

    void readSpeechCredit(inShell, () => invoke<string>("speech_credit")).then(
      setCredit,
    );
  }, []);

  return (
    <CapricePage
      lines={caprice.lines}
      problem={caprice.problem}
      hold={caprice.hold}
      talkPhase={caprice.talkPhase}
      talkHint={caprice.talkHint}
      talkStatus={caprice.talkStatus}
      credit={credit}
      onSubmit={caprice.submit}
    />
  );
}
