import type { Tool } from "@caprice/core";

export type LeagueBridge = {
  live: (path: string) => Promise<string>;
  lcu: (request: string) => Promise<string>;
};

const unavailable = "league client is not available in this window";

export function shellLeagueBridge(
  inShell: boolean,
  live: (path: string) => Promise<string>,
  lcu: (request: string) => Promise<string>,
): LeagueBridge {
  if (!inShell) {
    return {
      async live() {
        throw new Error(unavailable);
      },
      async lcu() {
        throw new Error(unavailable);
      },
    };
  }

  return { live, lcu };
}

export function leagueTools(bridge: LeagueBridge): Tool[] {
  return [
    {
      name: "league_live",
      run(input) {
        return asText(() => bridge.live(input));
      },
    },
    {
      name: "league_lcu",
      run(input) {
        return asText(() => bridge.lcu(input));
      },
    },
  ];
}

async function asText(run: () => Promise<string>): Promise<string> {
  try {
    return await run();
  } catch (caught) {
    if (caught instanceof Error && caught.message.length > 0) {
      return caught.message;
    }

    if (isString(caught) && caught.length > 0) {
      return caught;
    }

    return "league client failed";
  }
}

function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}
