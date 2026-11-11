# Chat over HTTP

The brain is accessed through an adapter. The assistant turn is the Vercel AI SDK `ToolLoopAgent`. Text and native are still the wire choices, and both go through that one loop. A new wire protocol is another adapter, not another branch in the session.

`CAPRICE_MODEL_URL` is the full chat URL and `CAPRICE_MODEL` selects the model. `CAPRICE_MODEL_API_KEY` is optional. `CAPRICE_MODEL_PROTOCOL` is `text` by default or `native`.

Text mode posts `{ model, messages }` and interprets the documented whole-reply call convention. Native mode supplies registered function tools and preserves assistant calls and tool-role results. One OpenAI-compatible provider sends that body. The shell posts it through `model_complete`. The browser posts it to the configured URL. The assistant caps tool executions at four and requests a closing answer with tools disabled. The original user request remains separate from results in either mode.

Inside Tauri, `model_endpoint` returns the model, the protocol, and `timeoutMs`. It does not return the URL or the key. `model_complete` accepts the chat body and a request identifier. Rust obtains the URL and bearer token itself. `model_cancel` targets that identifier. The page uses `timeoutMs` when the shell sends it, and 60 seconds otherwise. The transport bounds response size and duration. Outside Tauri, the browser posts to the configured endpoint, which must permit that page origin; cancellation aborts fetch.

Model access and process ownership are separate. An external endpoint may run locally or remotely. A managed runtime can start a configured local service and wait for readiness before using the same adapter. The runtime owns only children it starts, and model files are not inferred from a model name or silently downloaded.

Mastra stays set aside. The hand-rolled tool loop was replaced by `ToolLoopAgent`, not by a second framework or a memory service. Revisit a framework when durable workflows, memory services, or tracing justify replacing the current turn. Do not run two competing conversation loops.
