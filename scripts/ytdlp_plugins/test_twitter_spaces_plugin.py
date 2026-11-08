#!/usr/bin/env python3
"""Offline check that 14-character X Space ids are not truncated."""

import importlib.util
import unittest
from pathlib import Path

PLUGIN_FILE = (
    Path(__file__).resolve().parent
    / "spacepipe"
    / "yt_dlp_plugins"
    / "extractor"
    / "twitter_spaces.py"
)
SAMPLE = "https://x.com/i/spaces/1rJqboeezyXgAQ?s=20"
FULL_ID = "1rJqboeezyXgAQ"


def _load():
    spec = importlib.util.spec_from_file_location("spacepipe_twitter_spaces", PLUGIN_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TwitterSpacesPluginTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.mod = _load()
        except ModuleNotFoundError as exc:
            raise unittest.SkipTest(f"yt-dlp is not installed ({exc})") from exc

    def test_full_id_is_captured(self):
        ie = self.mod.TwitterSpacesCurrentIE()
        self.assertTrue(ie.suitable(SAMPLE))
        self.assertEqual(ie._match_id(SAMPLE), FULL_ID)
        self.assertEqual(len(ie._match_id(SAMPLE)), 14)

    def test_legacy_13_character_id_still_matches(self):
        url = "https://twitter.com/i/spaces/1OwxWwQOPlNxQ"
        ie = self.mod.TwitterSpacesCurrentIE()
        self.assertTrue(ie.suitable(url))
        self.assertEqual(ie._match_id(url), "1OwxWwQOPlNxQ")

    def test_builtin_still_truncates_when_unpatched(self):
        from yt_dlp.extractor.twitter import TwitterSpacesIE

        if "[0-9a-zA-Z]{13}" not in TwitterSpacesIE._VALID_URL:
            self.skipTest("installed yt-dlp already accepts variable-length Space ids")
        builtin = TwitterSpacesIE()
        self.assertTrue(builtin.suitable(SAMPLE))
        self.assertEqual(builtin._match_id(SAMPLE), FULL_ID[:13])


if __name__ == "__main__":
    unittest.main()
