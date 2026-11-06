import os


def pick_device(
    requested: str,
    cuda_count: int,
    compute_override: str | None,
) -> tuple[str, str]:
    if requested == "auto":
        device = "cuda" if cuda_count > 0 else "cpu"
    elif requested in ("cpu", "cuda"):
        device = requested
    else:
        raise ValueError("CAPRICE_STT_DEVICE must be auto, cpu, or cuda")

    override = "" if compute_override is None else compute_override.strip()
    if override != "":
        compute = override
    elif device == "cuda":
        compute = "float16"
    else:
        compute = "int8"
    return device, compute


def cuda_device_count() -> int:
    try:
        import ctranslate2

        count = ctranslate2.get_cuda_device_count()
    except Exception:
        return 0
    if count > 0:
        return count
    return 0


def engine_settings() -> tuple[str, str, str, str | None]:
    model = os.environ.get("CAPRICE_STT_MODEL", "").strip()
    if model == "":
        raise RuntimeError("CAPRICE_STT_MODEL is not set")

    if "CAPRICE_STT_DEVICE" not in os.environ:
        requested = "auto"
    else:
        requested = os.environ["CAPRICE_STT_DEVICE"].strip()
    if requested not in ("auto", "cpu", "cuda"):
        raise RuntimeError("CAPRICE_STT_DEVICE must be auto, cpu, or cuda")

    raw_compute = os.environ.get("CAPRICE_STT_COMPUTE")
    if raw_compute is None or raw_compute.strip() == "":
        override = None
    else:
        override = raw_compute.strip()

    count = cuda_device_count() if requested == "auto" else 0
    device, compute = pick_device(requested, count, override)

    raw_language = os.environ.get("CAPRICE_STT_LANGUAGE")
    if raw_language is None or raw_language.strip() == "":
        language = None
    else:
        language = raw_language.strip()
    return model, device, compute, language


class SpeechEngine:
    def __init__(self, model, device: str, compute: str, language: str | None) -> None:
        self.device = device
        self.compute = compute
        self._model = model
        self._language = language

    def transcribe(self, path: str) -> str:
        # faster-whisper loads Silero only when vad_filter is true.
        segments, _ = self._model.transcribe(
            path,
            language=self._language,
            vad_filter=False,
        )
        return "".join(segment.text for segment in segments).strip()


def load_engine() -> SpeechEngine:
    model_name, device, compute, language = engine_settings()
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device=device, compute_type=compute)
    return SpeechEngine(model, device, compute, language)
