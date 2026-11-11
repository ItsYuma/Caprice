# Agent SDK

The assistant turn is the Vercel AI SDK `ToolLoopAgent`. The hand-rolled loop is gone. One loop runs the text protocol and the native protocol. Text mode is still the whole-reply call convention. Native mode still sends registered tools. `stopWhen` allows four tool executions and then one answer with tools refused. Calls stay in model order.

Tools are the existing tool type. `defineTool` adds a Zod schema: `parse` checks the JSON and stores the canonical string, and `run` receives the parsed value. String tools keep `parse` and `run` as they are. The agent passes that string through `parse` before `run`.

MCP servers are a list the desktop parsed from `CAPRICE_MCP`. Core connects HTTP, SSE, and stdio with the transports `@ai-sdk/mcp` exports, adapts the tools, and returns a `close`. A server that is down is a failed result. Core does not read the environment.

The OpenAI-compatible provider sends the protocol body. The shell posts that body through the existing shell transport, so the page does not see the URL or the key. The browser posts it to the configured URL. The model name and the URL come from configuration.

Set aside: a second agent framework, and memory. Mastra stays deferred.
