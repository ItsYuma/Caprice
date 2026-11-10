# Reply color

A spoken reply is colored on the page, after `decodeAudioData` and before the buffer starts. `radioReply` in `packages/desktop/src/radio.ts` does it. Playback copies the colored samples onto every channel and plays that buffer, so an HTTP reply and a Woof reply take the same path. The box follows the colored samples.

The voice is raised two semitones and keeps its length, so the words do not speed up. `raisePitch` reads the buffer at `2 ** (semitones / 12)` through two heads half a grain apart. A triangle crossfade hides each wrap. The grain is 40 ms. The first grain blends from the dry sample, so the line still starts at full level. Two echoes follow, copies of that raised voice, 40 ms apart, at -10 dB and -16 dB. Tremolo still runs last: sine, 80 Hz, 15% wet, starting phase 0 degrees. That sine starts at the bottom of the cycle, so a full sample starts at 85% of itself and the top of the cycle is the original sample. The dry sample stays at its own index. A short line keeps the second echo, 80 ms after the end. A longer line carries the double inside the words.

Coloring is the pitch shift, the echo mix, and the tremolo, on samples the page has already decoded in order to play. A line of several seconds stays well under a second before `source.start()`. `voice` still ends when the reply bytes are ready, before this step.

`playClip` plays the returned bytes when the audio device does not open. That path has no decoded samples, so it stays the synthesis result.

Set aside: running FFmpeg on the reply, which is what CapriDesktop does for `cyber_android` (`highpass`, `flanger`, `aecho` at 18 ms and 28 ms, presence EQ) and for its other presets. A process start, plus a decode and an encode, sits before the first sample. Also set aside: coloring inside Woof or the HTTP client, a lead-in delay on the dry voice, and raising the dry voice by resampling it in place, which would make the words faster as well as higher. Overlap-add followed by a resample was set aside too: on a sine it landed about a semitone sharp.
