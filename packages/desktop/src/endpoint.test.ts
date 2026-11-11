import { expect, test } from "bun:test";

import { loadModelSource, readMcpServers } from "./endpoint.ts";

const emptyEnv = {
  CAPRICE_MODEL_URL: undefined,
  CAPRICE_MODEL: undefined,
  CAPRICE_MODEL_API_KEY: undefined,
  CAPRICE_MODEL_PROTOCOL: undefined,
};

test("outside the shell the page env is the endpoint", async () => {
  const source = await loadModelSource(
    {
      ...emptyEnv,
      CAPRICE_MODEL_URL: "http://page.example:40/chat",
      CAPRICE_MODEL: "page-model",
    },
    {
      inShell: false,
      async readShell() {
        throw new Error("shell was read");
      },
    },
  );

  expect(source).toEqual({
    where: "browser",
    endpoint: {
      url: "http://page.example:40/chat",
      model: "page-model",
      apiKey: "",
      protocol: "text",
    },
  });
});

test("an empty mcp list is no servers", () => {
  expect(readMcpServers(undefined)).toEqual([]);
  expect(readMcpServers(" ")).toEqual([]);
});

test("inside the shell the endpoint is model and protocol, never the key", async () => {
  const source = await loadModelSource(
    {
      ...emptyEnv,
      CAPRICE_MODEL_URL: "http://page.example/chat",
      CAPRICE_MODEL: "page-model",
      CAPRICE_MODEL_API_KEY: "page-key",
      CAPRICE_MODEL_PROTOCOL: "native",
    },
    {
      inShell: true,
      async readShell() {
        return {
          model: "shell-model",
          protocol: "text",
        };
      },
    },
  );

  expect(source).toEqual({
    where: "shell",
    config: {
      model: "shell-model",
      protocol: "text",
    },
  });
});
