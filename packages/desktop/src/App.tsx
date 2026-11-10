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
      () => {
        setCredit("");
      },
    );
  }, []);

  return (
    <CapricePage
      problem={caprice.problem}
      hold={caprice.hold}
      talkPhase={caprice.talkPhase}
      hint={caprice.hint}
      credit={credit}
      pace={caprice.pace}
      step={caprice.step}
      stepAt={caprice.stepAt}
    />
  );
}
