# Spoken reply

A capri line is spoken by one reply engine. `CAPRICE_TTS_ENGINE` selects it. Empty or `http` is an HTTP POST. `woof` is a resident child. The speech worker is not involved. It stays the listener.

## HTTP

`CAPRICE_TTS_URL` is the full URL. `CAPRICE_TTS_MODEL` is the `model` field. The body is `{ model, input }`. `CAPRICE_TTS_VOICE` adds `voice` only when it is non-empty. `CAPRICE_TTS_API_KEY` is an optional bearer token. An empty key sends no authorization header. The source has no host, port, or voice id.

Each capri line is one POST. The response bytes are what the page plays. Inside the Tauri window, Rust posts and returns those bytes as base64. Outside it, the page posts only when both the URL and the model name are set. Otherwise speaking rejects with `speech is not configured`. Blank text does not post.

## Woof

`woof` speaks with [Underdog Woof](https://huggingface.co/ConwayResearch/Underdog-Woof), the two-voice numpy package. `CAPRICE_TTS_WOOF` is the directory from `hf download ConwayResearch/Underdog-Woof --local-dir`. The child is `python3 -u`. `CAPRICE_PYTHON` replaces that program when it is set, so a virtual environment can own numpy. It imports `Woof` once and stays warm. Empty or `juno` is Juno. `mira` is Mira. A voice change or a directory change starts a new child. Leaving the window stops it.

The child is a pipe, not JSON. The parent writes a little-endian length and the UTF-8 text. The child writes a little-endian status and a frame. Status 0 is a wav file. Status 1 is an error and the child stays. A short read, a frame above 8 MiB, or any other status drops the child. Its stdout is pointed at stderr before the import, so library logs do not sit in the wav.

The licence sentence is `Voice by Underdog Woof`. Commercial use is outside this licence.

Set aside: a Woof variant inside the speech worker, linking the weights into the Tauri process, the Web Speech API, and starting Handy or another speech app.
