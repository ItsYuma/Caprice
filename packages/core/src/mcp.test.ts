import { expect, test } from "bun:test";

import { connectMcp, parseMcpServers } from "./mcp.ts";

test("empty mcp config is no servers", () => {
  expect(parseMcpServers(undefined)).toEqual([]);
  expect(parseMcpServers("  ")).toEqual([]);
});

test("mcp config lists http, sse, and stdio", () => {
  expect(
    parseMcpServers(
      JSON.stringify([
        {
          transport: "http",
          url: "http://mcp.example/mcp",
          headers: [{ name: "authorization", value: "Bearer t" }],
        },
        { transport: "sse", url: "http://mcp.example/sse" },
        { transport: "stdio", command: "server", args: ["--flag"] },
      ]),
    ),
  ).toEqual([
    {
      transport: "http",
      url: "http://mcp.example/mcp",
      headers: [{ name: "authorization", value: "Bearer t" }],
    },
    {
      transport: "sse",
      url: "http://mcp.example/sse",
      headers: [],
    },
    {
      transport: "stdio",
      command: "server",
      args: ["--flag"],
    },
  ]);
});

test("bad mcp config is rejected", () => {
  expect(() => parseMcpServers("{")).toThrow("CAPRICE_MCP is not valid");
  expect(() => parseMcpServers('{"transport":"http"}')).toThrow(
    "CAPRICE_MCP is not valid",
  );
});

test("a down mcp server is a failed result", async () => {
  const connected = await connectMcp([
    {
      transport: "http",
      url: "http://127.0.0.1:9/mcp",
      headers: [],
    },
  ]);

  expect(connected.ok).toBe(false);
});
