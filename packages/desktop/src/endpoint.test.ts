import { expect, test } from "bun:test";

import { loadModelEndpoint } from "./endpoint.ts";

test("outside the shell the page env is the endpoint", async () => {
  const endpoint = await loadModelEndpoint(
    {
      CAPRICE_MODEL_URL: "http://page.example:40/chat",
      CAPRICE_MODEL: "page-model",
      CAPRICE_MODEL_API_KEY: undefined,
    },
    {
      inShell: false,
      async readShell() {
        throw new Error("shell was read");
      },
    },
  );

  expect(endpoint).toEqual({
    url: "http://page.example:40/chat",
    model: "page-model",
    apiKey: "",
  });
});

test("inside the shell the window env replaces the page env", async () => {
  const endpoint = await loadModelEndpoint(
    {
      CAPRICE_MODEL_URL: "http://page.example/chat",
      CAPRICE_MODEL: "page-model",
      CAPRICE_MODEL_API_KEY: "page-key",
    },
    {
      inShell: true,
      async readShell() {
        return {
          url: "http://10.1.2.3:11434/v1/chat/completions",
          model: "shell-model",
          apiKey: "shell-key",
        };
      },
    },
  );

  expect(endpoint).toEqual({
    url: "http://10.1.2.3:11434/v1/chat/completions",
    model: "shell-model",
    apiKey: "shell-key",
  });
});
