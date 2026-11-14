import os
import sys
import json
import unittest

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SPACES_DIR = os.path.join(BASE_DIR, "spaces", "zerogpu-transcriber")

if SPACES_DIR not in sys.path:
    sys.path.insert(0, SPACES_DIR)

import app


class TestZeroGPUApp(unittest.TestCase):

    def test_api_key_validation(self):
        os.environ["SPACE_API_KEY"] = "secret123"
        self.assertTrue(app.validate_api_key("secret123"))
        self.assertFalse(app.validate_api_key("wrong_key"))
        self.assertFalse(app.validate_api_key(""))

        # Test open if empty
        os.environ["SPACE_API_KEY"] = ""
        self.assertTrue(app.validate_api_key("anything"))

    def test_audio_url_host_allowlist(self):
        valid_urls = [
            "https://github.com/aiandbotsgalore/repo/releases/download/v1/audio.mp3",
            "https://objects.githubusercontent.com/github-production-release-asset/audio.mp3",
            "https://huggingface.co/datasets/user/repo/resolve/main/audio.wav"
        ]
        for u in valid_urls:
            self.assertEqual(app.validate_audio_url(u), u)

        invalid_urls = [
            "http://169.254.169.254/latest/meta-data/",
            "https://evil-host.com/malicious.wav",
            "https://attacker.org/ssrf"
        ]
        for u in invalid_urls:
            with self.assertRaises(ValueError):
                app.validate_audio_url(u)

    def test_unauthorized_endpoints(self):
        os.environ["SPACE_API_KEY"] = "supersecret"
        res_transcribe = json.loads(app.transcribe_endpoint(
            "https://github.com/audio.mp3",
            api_key="bad_key"
        ))
        self.assertIn("error", res_transcribe)
        self.assertIn("Unauthorized", res_transcribe["error"])

        res_rediarize = json.loads(app.rediarize_endpoint(
            "https://github.com/audio.mp3",
            existing_segments_json="[]",
            api_key="bad_key"
        ))
        self.assertIn("error", res_rediarize)
        self.assertIn("Unauthorized", res_rediarize["error"])


if __name__ == "__main__":
    unittest.main()
