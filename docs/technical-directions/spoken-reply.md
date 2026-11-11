# Spoken reply

A capri line is spoken by one reply engine. `CAPRICE_TTS_ENGINE` selects it. Empty or `http` is an HTTP POST. Piper and Kokoro can be discovered and chosen, and synthesizing either returns that the family is not loaded yet. No audio is invented for them. The listener is in-process (`local-speech.md`).

## HTTP

`CAPRICE_TTS_URL` is the full URL. `CAPRICE_TTS_MODEL` is the `model` field. The body is `{ model, input }`. `CAPRICE_TTS_VOICE` adds `voice` only when it is non-empty. `CAPRICE_TTS_API_KEY` is an optional bearer token. An empty key sends no authorization header. The source has no host, port, or voice id.

Each capri line is one POST. The response bytes are the synthesis result. The page decodes them and colors the samples before playback (`reply-color.md`). Inside the Tauri window, Rust posts and returns those bytes as base64. Outside it, the page posts only when both the URL and the model name are set. Otherwise speaking rejects with `speech is not configured`. Blank text does not post.

`speech_credit` is empty for HTTP and for Parakeet.

Set aside: Underdog Woof as a resident Python child, a Woof variant inside a speech worker, linking those weights into the Tauri process, the Web Speech API, and starting Handy or another speech app.
