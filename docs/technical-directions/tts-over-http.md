# Speech over HTTP

Spoken replies come from an HTTP endpoint. Caprice does not load a text-to-speech model.

`CAPRICE_TTS_URL` is the full URL. `CAPRICE_TTS_MODEL` is the `model` field. The body is `{ model, input }`. `CAPRICE_TTS_VOICE` adds `voice` only when it is non-empty. `CAPRICE_TTS_API_KEY` is an optional bearer token. An empty key sends no authorization header. The source has no host, port, or voice id.

Each capri line is one POST. The response bytes are what the page plays. Inside the Tauri window, Rust posts and returns those bytes as base64. Outside it, the page posts only when both the URL and the model name are set. Otherwise speaking rejects with `speech is not configured`. Blank text does not post.

Set aside: a resident TTS model in the shell, the Web Speech API, and starting Handy or another speech app. A local server that Caprice must keep alive later is a supervisor next to this client, not weights linked into the process. That supervisor is not built.
