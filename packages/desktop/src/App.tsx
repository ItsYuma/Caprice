import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

import { CapricePage } from "./CapricePage.tsx";
import { SettingsPage } from "./Settings.tsx";
import { showsSettings } from "./settings.ts";
import { readSpeechCredit } from "./speech.ts";
import { useSession } from "./useSession.ts";

export function App() {
  const inShell = "__TAURI_INTERNALS__" in window;
  const label = inShell ? getCurrentWindow().label : "";

  if (showsSettings(inShell, label)) {
    return <SettingsPage />;
  }

  return <PresenceApp />;
}

function PresenceApp() {
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
      step={caprice.step}
    />
  );
}
