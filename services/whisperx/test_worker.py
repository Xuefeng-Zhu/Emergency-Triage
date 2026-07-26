import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("DATA_ROOT_CONTAINER", tempfile.gettempdir())

from worker import normalize_segments, safe_audio_path  # noqa: E402


class WorkerHelpersTest(unittest.TestCase):
    def test_normalize_segments_uses_milliseconds(self):
        result = normalize_segments(
            [
                {
                    "start": 1.25,
                    "end": 2.5,
                    "text": " hello ",
                    "speaker": "SPEAKER_00",
                    "words": [{"word": "hello", "start": 1.25, "end": 2.5}],
                }
            ]
        )
        self.assertEqual(result[0]["startMs"], 1250)
        self.assertEqual(result[0]["endMs"], 2500)
        self.assertEqual(result[0]["text"], "hello")

    def test_safe_audio_path_rejects_escape_and_non_flac(self):
        with self.assertRaises(ValueError):
            safe_audio_path("/etc/passwd")
        with self.assertRaises(ValueError):
            safe_audio_path(str(Path(tempfile.gettempdir()) / "audio.wav"))


if __name__ == "__main__":
    unittest.main()
