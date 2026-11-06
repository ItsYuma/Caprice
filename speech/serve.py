import json
from typing import Protocol, TextIO


class Engine(Protocol):
    device: str
    compute: str

    def transcribe(self, path: str) -> str: ...


def write_line(stdout: TextIO, payload: dict[str, str]) -> None:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    buffer = getattr(stdout, "buffer", None)
    if buffer is not None:
        buffer.write(encoded.encode("utf-8"))
        buffer.flush()
        return
    stdout.write(encoded)
    stdout.flush()


def serve(engine: Engine, stdin: TextIO, stdout: TextIO) -> None:
    write_line(
        stdout,
        {"type": "ready", "device": engine.device, "compute": engine.compute},
    )
    while True:
        line = stdin.readline()
        if line == "":
            return
        if line.lstrip("\ufeff").strip() == "":
            continue
        reply(engine, line, stdout)


def reply(engine: Engine, line: str, stdout: TextIO) -> None:
    request = _request(line)
    if request is None:
        write_line(stdout, {"type": "error", "message": "malformed request"})
        return
    request_id = request.get("id")
    if not isinstance(request_id, str):
        write_line(stdout, {"type": "error", "message": "malformed request"})
        return
    if request.get("op") != "transcribe":
        write_line(stdout, {"id": request_id, "error": "unknown op"})
        return
    path = request.get("path")
    if not isinstance(path, str):
        write_line(stdout, {"id": request_id, "error": "path is required"})
        return
    try:
        text = engine.transcribe(path)
    except Exception as exc:
        message = str(exc).strip() or exc.__class__.__name__
        write_line(stdout, {"id": request_id, "error": message})
        return
    if not isinstance(text, str):
        write_line(stdout, {"id": request_id, "error": "transcript was not text"})
        return
    write_line(stdout, {"id": request_id, "text": text})


def _request(line: str) -> dict | None:
    try:
        request = json.loads(line.lstrip("\ufeff"))
    except Exception:
        return None
    if not isinstance(request, dict):
        return None
    return request
