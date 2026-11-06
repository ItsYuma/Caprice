import importlib.util
import inspect
import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from speech.engine import (
    SpeechEngine,
    cuda_device_count,
    engine_settings,
    pick_device,
)
from speech.serve import serve
from speech.worker import main

_ENV_KEYS = (
    "CAPRICE_STT_MODEL",
    "CAPRICE_STT_DEVICE",
    "CAPRICE_STT_COMPUTE",
    "CAPRICE_STT_LANGUAGE",
)


class FakeEngine:
    def __init__(self, device: str = "cpu", compute: str = "int8") -> None:
        self.device = device
        self.compute = compute
        self.paths: list[str] = []
        self.failures = 0
        self.text: str | None = None

    def transcribe(self, path: str) -> str:
        self.paths.append(path)
        if self.failures > 0:
            self.failures -= 1
            raise RuntimeError("transcription failed")
        if self.text is not None:
            return self.text
        return path


class Segment:
    def __init__(self, text: str) -> None:
        self.text = text


class RecordingModel:
    def __init__(self, segments: list[Segment]) -> None:
        self.segments = segments
        self.calls: list[tuple[str, dict]] = []

    def transcribe(self, path: str, **kwargs):
        self.calls.append((path, kwargs))
        return self.segments, None


class CountingStdout(io.StringIO):
    def __init__(self) -> None:
        super().__init__()
        self.flushes = 0

    def flush(self) -> None:
        self.flushes += 1
        super().flush()


def exchange(engine, text: str, stdout: io.StringIO | None = None):
    if stdout is None:
        stdout = io.StringIO()
    serve(engine, io.StringIO(text), stdout)
    raw = stdout.getvalue()
    parsed = [json.loads(line) for line in raw.splitlines()]
    return raw, parsed


class ServeTest(unittest.TestCase):
    def test_ready_reports_device_and_compute(self) -> None:
        cases = (("cpu", "int8"), ("cuda", "float16"))
        for device, compute in cases:
            with self.subTest(device=device, compute=compute):
                raw, parsed = exchange(FakeEngine(device, compute), "")
                self.assertEqual(
                    raw,
                    f'{{"type":"ready","device":"{device}","compute":"{compute}"}}\n',
                )
                self.assertEqual(
                    parsed,
                    [{"type": "ready", "device": device, "compute": compute}],
                )

    def test_transcribe_echoes_path(self) -> None:
        engine = FakeEngine()
        raw, parsed = exchange(
            engine,
            '{"id":"t1","op":"transcribe","path":"/tmp/clip.wav"}\n',
        )
        self.assertEqual(engine.paths, ["/tmp/clip.wav"])
        self.assertEqual(
            parsed,
            [
                {"type": "ready", "device": "cpu", "compute": "int8"},
                {"id": "t1", "text": "/tmp/clip.wav"},
            ],
        )
        self.assertEqual(len(raw.splitlines()), 2)

    def test_engine_exception_then_next_request(self) -> None:
        engine = FakeEngine()
        engine.failures = 1
        _, parsed = exchange(
            engine,
            "\n".join(
                [
                    '{"id":"bad","op":"transcribe","path":"/tmp/bad.wav"}',
                    '{"id":"good","op":"transcribe","path":"/tmp/good.wav"}',
                    "",
                ]
            ),
        )
        self.assertEqual(
            parsed,
            [
                {"type": "ready", "device": "cpu", "compute": "int8"},
                {"id": "bad", "error": "transcription failed"},
                {"id": "good", "text": "/tmp/good.wav"},
            ],
        )
        self.assertEqual(engine.paths, ["/tmp/bad.wav", "/tmp/good.wav"])

    def test_unknown_op_stays_alive(self) -> None:
        engine = FakeEngine()
        _, parsed = exchange(
            engine,
            "\n".join(
                [
                    '{"id":"u","op":"listen","path":"/tmp/clip.wav"}',
                    '{"id":"t","op":"transcribe","path":"/tmp/clip.wav"}',
                ]
            ),
        )
        self.assertEqual(parsed[1], {"id": "u", "error": "unknown op"})
        self.assertEqual(parsed[2], {"id": "t", "text": "/tmp/clip.wav"})
        self.assertEqual(engine.paths, ["/tmp/clip.wav"])

    def test_blank_lines_are_ignored(self) -> None:
        engine = FakeEngine()
        _, parsed = exchange(
            engine,
            '\n   \n{"id":"t","op":"transcribe","path":"/tmp/a.wav"}\n\n',
        )
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[1]["text"], "/tmp/a.wav")

    def test_malformed_json_keeps_reading(self) -> None:
        engine = FakeEngine()
        raw, parsed = exchange(
            engine,
            "\n".join(
                [
                    "not json",
                    "[1, 2]",
                    '{"id":"t","op":"transcribe","path":"/tmp/a.wav"}',
                ]
            ),
        )
        self.assertEqual(
            parsed[1],
            {"type": "error", "message": "malformed request"},
        )
        self.assertEqual(
            parsed[2],
            {"type": "error", "message": "malformed request"},
        )
        self.assertEqual(parsed[3], {"id": "t", "text": "/tmp/a.wav"})
        self.assertNotIn('"id"', raw.splitlines()[1])

    def test_missing_id_keeps_reading(self) -> None:
        engine = FakeEngine()
        _, parsed = exchange(
            engine,
            "\n".join(
                [
                    '{"op":"transcribe","path":"/tmp/a.wav"}',
                    '{"id":null,"op":"transcribe","path":"/tmp/a.wav"}',
                    '{"id":"t","op":"transcribe","path":"/tmp/b.wav"}',
                ]
            ),
        )
        self.assertEqual(
            parsed[1],
            {"type": "error", "message": "malformed request"},
        )
        self.assertEqual(
            parsed[2],
            {"type": "error", "message": "malformed request"},
        )
        self.assertEqual(parsed[3], {"id": "t", "text": "/tmp/b.wav"})
        self.assertEqual(engine.paths, ["/tmp/b.wav"])

    def test_missing_path_is_an_error_for_that_id(self) -> None:
        engine = FakeEngine()
        _, parsed = exchange(
            engine,
            '{"id":"p","op":"transcribe"}\n{"id":"t","op":"transcribe","path":"/tmp/a.wav"}\n',
        )
        self.assertEqual(parsed[1], {"id": "p", "error": "path is required"})
        self.assertEqual(parsed[2]["text"], "/tmp/a.wav")

    def test_transcript_stays_on_one_utf8_line(self) -> None:
        engine = FakeEngine()
        engine.text = 'say "hi"\ncafé'
        raw, parsed = exchange(
            engine,
            '{"id":"t","op":"transcribe","path":"/tmp/a.wav"}',
        )
        self.assertEqual(len(raw.splitlines()), 2)
        self.assertEqual(parsed[1]["text"], 'say "hi"\ncafé')
        self.assertIn("café", raw)

    def test_multiline_exception_stays_one_line(self) -> None:
        class Boom(FakeEngine):
            def transcribe(self, path: str) -> str:
                raise RuntimeError('bad "quote"\nsecond')

        raw, parsed = exchange(
            Boom(),
            '{"id":"e","op":"transcribe","path":"/tmp/a.wav"}\n',
        )
        self.assertEqual(len(raw.splitlines()), 2)
        self.assertEqual(parsed[1], {"id": "e", "error": 'bad "quote"\nsecond'})

    def test_blank_exception_uses_class_name(self) -> None:
        class Blank(Exception):
            def __str__(self) -> str:
                return "  "

        class Boom(FakeEngine):
            def transcribe(self, path: str) -> str:
                raise Blank()

        _, parsed = exchange(
            Boom(),
            '{"id":"e","op":"transcribe","path":"/tmp/a.wav"}\n',
        )
        self.assertEqual(parsed[1], {"id": "e", "error": "Blank"})

    def test_non_text_transcript_is_an_error(self) -> None:
        class Numbers(FakeEngine):
            def transcribe(self, path: str) -> str:
                self.paths.append(path)
                if len(self.paths) == 1:
                    return 3
                return path

        _, parsed = exchange(
            Numbers(),
            '{"id":"n","op":"transcribe","path":"/tmp/a.wav"}\n{"id":"t","op":"transcribe","path":"/tmp/b.wav"}\n',
        )
        self.assertEqual(parsed[1], {"id": "n", "error": "transcript was not text"})
        self.assertEqual(parsed[2]["text"], "/tmp/b.wav")

    def test_utf8_bytes_bypass_text_encoding(self) -> None:
        raw = io.BytesIO()
        stdout = io.TextIOWrapper(raw, encoding="ascii", newline="\r\n")
        engine = FakeEngine()
        engine.text = "café"
        serve(
            engine,
            io.StringIO('{"id":"t","op":"transcribe","path":"/tmp/a.wav"}\n'),
            stdout,
        )
        data = raw.getvalue()
        self.assertNotIn(b"\r\n", data)
        self.assertIn("café".encode(), data)
        parsed = [json.loads(line) for line in data.decode("utf-8").splitlines()]
        self.assertEqual(parsed[0]["device"], "cpu")
        self.assertEqual(parsed[1], {"id": "t", "text": "café"})

    def test_flushes_every_line(self) -> None:
        stdout = CountingStdout()
        _, parsed = exchange(
            FakeEngine(),
            '{"id":"t","op":"transcribe","path":"/tmp/a.wav"}\n',
            stdout,
        )
        self.assertEqual(len(parsed), 2)
        self.assertGreaterEqual(stdout.flushes, 2)

    def test_last_request_without_newline(self) -> None:
        _, parsed = exchange(
            FakeEngine(),
            '{"id":"t","op":"transcribe","path":"/tmp/a.wav"}',
        )
        self.assertEqual(parsed[1]["text"], "/tmp/a.wav")

    def test_serve_does_not_reference_faster_whisper(self) -> None:
        source = Path(__file__).with_name("serve.py").read_text(encoding="utf-8")
        self.assertNotIn("faster_whisper", source)
        self.assertNotIn("ctranslate2", source)
        self.assertNotIn("vad_filter", source)


class PickDeviceTest(unittest.TestCase):
    def test_auto_without_cuda_is_cpu_int8(self) -> None:
        self.assertEqual(pick_device("auto", 0, None), ("cpu", "int8"))

    def test_auto_with_cuda_is_cuda_float16(self) -> None:
        self.assertEqual(pick_device("auto", 1, None), ("cuda", "float16"))

    def test_cpu_stays_cpu_when_cuda_is_present(self) -> None:
        self.assertEqual(pick_device("cpu", 1, None), ("cpu", "int8"))

    def test_cuda_request_is_cuda_float16(self) -> None:
        self.assertEqual(pick_device("cuda", 0, None), ("cuda", "float16"))

    def test_compute_override_wins(self) -> None:
        self.assertEqual(pick_device("cpu", 0, "float16"), ("cpu", "float16"))
        self.assertEqual(pick_device("cuda", 1, "int8"), ("cuda", "int8"))
        self.assertEqual(pick_device("auto", 1, "int8"), ("cuda", "int8"))
        self.assertEqual(pick_device("auto", 0, " float16 "), ("cpu", "float16"))

    def test_empty_override_means_unset(self) -> None:
        self.assertEqual(pick_device("cpu", 1, ""), ("cpu", "int8"))
        self.assertEqual(pick_device("cuda", 0, ""), ("cuda", "float16"))
        self.assertEqual(pick_device("auto", 0, "   "), ("cpu", "int8"))
        self.assertEqual(pick_device("auto", 2, None), ("cuda", "float16"))


class SpeechEngineTest(unittest.TestCase):
    def test_transcribe_joins_and_strips(self) -> None:
        model = RecordingModel([Segment("  alpha"), Segment(" beta  ")])
        engine = SpeechEngine(model, "cpu", "int8", None)
        self.assertEqual(engine.device, "cpu")
        self.assertEqual(engine.compute, "int8")
        self.assertEqual(engine.transcribe("/tmp/a.wav"), "alpha beta")
        path, kwargs = model.calls[0]
        self.assertEqual(path, "/tmp/a.wav")
        self.assertIsNone(kwargs["language"])
        self.assertIs(kwargs["vad_filter"], False)

    def test_transcribe_passes_language(self) -> None:
        model = RecordingModel([Segment("a"), Segment("b")])
        engine = SpeechEngine(model, "cuda", "float16", "ja")
        self.assertEqual(engine.transcribe("/tmp/b.wav"), "ab")
        self.assertEqual(model.calls[0][1]["language"], "ja")

    def test_empty_segments_are_empty_text(self) -> None:
        model = RecordingModel([])
        engine = SpeechEngine(model, "cpu", "int8", None)
        self.assertEqual(engine.transcribe("/tmp/c.wav"), "")

    def test_vad_filter_true_is_absent(self) -> None:
        source = Path(__file__).with_name("engine.py").read_text(encoding="utf-8")
        compact = "".join(source.split())
        self.assertNotIn("vad_filter=True", compact)
        self.assertIn("vad_filter=False", compact)

    def test_faster_whisper_import_is_inside_load_engine(self) -> None:
        module = inspect.getsource(sys.modules["speech.engine"])
        before_load, load_source = module.split("def load_engine", 1)
        self.assertNotIn("faster_whisper", before_load)
        self.assertIn("from faster_whisper import WhisperModel", load_source)
        self.assertIn("device=device", load_source)
        self.assertIn("compute_type=compute", load_source)
        self.assertNotIn("vad_filter", load_source)
        self.assertNotIn("faster_whisper", sys.modules)


class EnvCase(unittest.TestCase):
    def setUp(self) -> None:
        self.saved = {key: os.environ.get(key) for key in _ENV_KEYS}
        for key in _ENV_KEYS:
            os.environ.pop(key, None)

    def tearDown(self) -> None:
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class EnvTest(EnvCase):
    def test_missing_model(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "^CAPRICE_STT_MODEL is not set$"):
            engine_settings()

    def test_empty_model(self) -> None:
        os.environ["CAPRICE_STT_MODEL"] = "   "
        with self.assertRaisesRegex(RuntimeError, "^CAPRICE_STT_MODEL is not set$"):
            engine_settings()

    def test_invalid_device(self) -> None:
        os.environ["CAPRICE_STT_MODEL"] = "tiny"
        os.environ["CAPRICE_STT_DEVICE"] = "gpu"
        with self.assertRaisesRegex(
            RuntimeError,
            "^CAPRICE_STT_DEVICE must be auto, cpu, or cuda$",
        ):
            engine_settings()

    def test_unset_device_means_auto(self) -> None:
        os.environ["CAPRICE_STT_MODEL"] = "tiny"
        _, device, compute, language = engine_settings()
        self.assertEqual((device, compute), pick_device("auto", cuda_device_count(), None))
        self.assertIsNone(language)

    def test_blank_device_is_rejected(self) -> None:
        os.environ["CAPRICE_STT_MODEL"] = "tiny"
        os.environ["CAPRICE_STT_DEVICE"] = "  "
        with self.assertRaisesRegex(
            RuntimeError,
            "^CAPRICE_STT_DEVICE must be auto, cpu, or cuda$",
        ):
            engine_settings()

    def test_cpu_ignores_cuda_and_blank_compute(self) -> None:
        os.environ["CAPRICE_STT_MODEL"] = "  org/model  "
        os.environ["CAPRICE_STT_DEVICE"] = "cpu"
        os.environ["CAPRICE_STT_COMPUTE"] = "  "
        model, device, compute, language = engine_settings()
        self.assertEqual(model, "org/model")
        self.assertEqual((device, compute), ("cpu", "int8"))
        self.assertIsNone(language)
        self.assertNotIn("faster_whisper", sys.modules)

    def test_cuda_and_language_and_compute_override(self) -> None:
        os.environ["CAPRICE_STT_MODEL"] = "tiny"
        os.environ["CAPRICE_STT_DEVICE"] = " cuda "
        os.environ["CAPRICE_STT_COMPUTE"] = " int8 "
        os.environ["CAPRICE_STT_LANGUAGE"] = " fr "
        model, device, compute, language = engine_settings()
        self.assertEqual(model, "tiny")
        self.assertEqual((device, compute, language), ("cuda", "int8", "fr"))

    def test_blank_language_is_detect(self) -> None:
        os.environ["CAPRICE_STT_MODEL"] = "tiny"
        os.environ["CAPRICE_STT_DEVICE"] = "cpu"
        os.environ["CAPRICE_STT_LANGUAGE"] = "  "
        self.assertIsNone(engine_settings()[3])

    def test_missing_ctranslate2_counts_as_zero(self) -> None:
        if importlib.util.find_spec("ctranslate2") is not None:
            self.skipTest("ctranslate2 is installed")
        self.assertEqual(cuda_device_count(), 0)
        self.assertEqual(pick_device("auto", cuda_device_count(), None), ("cpu", "int8"))


class WorkerTest(EnvCase):
    def test_main_missing_model_exits_without_ready(self) -> None:
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            with self.assertRaises(SystemExit) as caught:
                main()
        self.assertEqual(caught.exception.code, 1)
        self.assertEqual(
            stdout.getvalue(),
            '{"type":"error","message":"CAPRICE_STT_MODEL is not set"}\n',
        )

    def test_main_invalid_device_exits_without_ready(self) -> None:
        os.environ["CAPRICE_STT_MODEL"] = "tiny"
        os.environ["CAPRICE_STT_DEVICE"] = "metal"
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            with self.assertRaises(SystemExit) as caught:
                main()
        self.assertEqual(caught.exception.code, 1)
        self.assertEqual(
            json.loads(stdout.getvalue()),
            {
                "type": "error",
                "message": "CAPRICE_STT_DEVICE must be auto, cpu, or cuda",
            },
        )
        self.assertNotIn("ready", stdout.getvalue())

    def test_main_load_failure_is_an_error_line(self) -> None:
        if importlib.util.find_spec("faster_whisper") is not None:
            self.skipTest("faster-whisper is installed")
        os.environ["CAPRICE_STT_MODEL"] = "tiny"
        os.environ["CAPRICE_STT_DEVICE"] = "cpu"
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            with self.assertRaises(SystemExit) as caught:
                main()
        self.assertEqual(caught.exception.code, 1)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["type"], "error")
        self.assertIn("faster_whisper", payload["message"])
        self.assertNotIn("ready", stdout.getvalue())
        self.assertNotIn("faster_whisper", sys.modules)


if __name__ == "__main__":
    unittest.main()
