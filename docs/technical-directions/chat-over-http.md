# Chat over HTTP

The brain is a chat endpoint. Caprice does not load its weights.

`CAPRICE_MODEL_URL` is the full URL. `CAPRICE_MODEL` is the `model` field. The body is `{ model, messages }`. The reply is the string at `choices[0].message.content`. `CAPRICE_MODEL_API_KEY` is an optional bearer token. An empty key sends no authorization header. The source has no host, port, or model name.

`chatModel` turns a session turn into those messages. The persona is the system message. Each stored line is a user or assistant message. `hostText` is added only when it is not already the last host line. `stubModel` stays for tests and does not post.

Inside the Tauri window, the page reads the process environment through `model_endpoint`, and Rust posts the body with `model_complete`. Outside the window, Vite passes the same names and the page posts. That endpoint must allow the page origin.

Set aside: loading the chat weights in the shell or in a TypeScript worker, a default model, and an agent framework in front of the endpoint. The session already owns the turns. League tools are calls in that session, described in `docs/technical-directions/league-client-apis.md`. They do not add a framework or a `tools` field to this body. The endpoint already speaks this body, so another model is a different URL and name.
