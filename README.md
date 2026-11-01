# Caprice

> "Hey, little baby. Wake up. Your computer has a girl in it now."

Annoying desktop companion inspired by Capri from _Cyberpunk: Edgerunners 2_. She talks back. Later she handles tasks, after you confirm them.

```sh
bun install
bun test
CAPRICE_MODEL_URL=http://your-brain/v1/chat/completions CAPRICE_MODEL=your-model bun run dev
```

`CAPRICE_MODEL_URL` and `CAPRICE_MODEL` are required. Nothing in the repo picks them for you.

How the repo is put together: `AGENTS.md` and `docs/architecture.md`. Who she is allowed to be: `CAPRI.md`. What is next: `MILESTONES.md`.
