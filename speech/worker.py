import sys
from pathlib import Path


def main() -> None:
    root = str(Path(__file__).resolve().parent.parent)
    if root not in sys.path:
        sys.path.insert(0, root)
    from speech.engine import load_engine
    from speech.serve import serve, write_line

    for stream in (sys.stdin, sys.stdout):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")
    try:
        engine = load_engine()
    except Exception as exc:
        message = str(exc).strip() or exc.__class__.__name__
        write_line(sys.stdout, {"type": "error", "message": message})
        sys.exit(1)
    serve(engine, sys.stdin, sys.stdout)


if __name__ == "__main__":
    main()
