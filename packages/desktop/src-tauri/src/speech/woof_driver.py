import os
import sys

saved_stdout = os.dup(sys.stdout.fileno())
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
sys.stdout = sys.stderr

import io
import struct

from underdog_woof import Woof


def read_exact(count):
    chunks = []
    remaining = count
    while remaining:
        chunk = os.read(0, remaining)
        if not chunk:
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def write_all(payload):
    view = memoryview(payload)
    while view:
        written = os.write(saved_stdout, view)
        if written <= 0:
            raise SystemExit(1)
        view = view[written:]


def write_frame(status, payload):
    write_all(struct.pack("<II", status, len(payload)) + payload)


voice = sys.argv[1] if len(sys.argv) > 1 else "juno"
speaker = Woof(voice=voice)

while True:
    header = read_exact(4)
    if header is None:
        break
    (length,) = struct.unpack("<I", header)
    if length > 8 * 1024 * 1024:
        raise SystemExit(1)
    body = read_exact(length)
    if body is None:
        break
    try:
        audio = speaker(body.decode("utf-8"))
        sink = io.BytesIO()
        speaker.save(sink, audio)
        write_frame(0, sink.getvalue())
    except Exception as err:
        write_frame(1, str(err).encode())
