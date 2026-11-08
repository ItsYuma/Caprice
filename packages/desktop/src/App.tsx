import { Composer } from "./Composer.tsx";
import { Log } from "./Log.tsx";
import { useSession } from "./useSession.ts";

export function App() {
  const caprice = useSession();

  return (
    <main>
      <h1>Caprice</h1>
      <p className="lede">Hey. Your computer has a girl in it now.</p>
      <Log lines={caprice.lines} problem={caprice.problem} />
      <Composer onSubmit={caprice.submit} />
    </main>
  );
}
