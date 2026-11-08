import { CapricePage } from "./CapricePage.tsx";
import { useSession } from "./useSession.ts";

export function App() {
  const caprice = useSession();

  return (
    <CapricePage
      lines={caprice.lines}
      problem={caprice.problem}
      hold={caprice.hold}
      talkPhase={caprice.talkPhase}
      talkHint={caprice.talkHint}
      talkStatus={caprice.talkStatus}
      onSubmit={caprice.submit}
    />
  );
}
