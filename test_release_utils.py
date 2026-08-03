import unittest

from scripts.release_utils import (
    duration_to_seconds,
    has_asset_with_extension,
    release_field,
    release_metadata,
    youtube_rss_eligible,
)


class ReleaseUtilsTests(unittest.TestCase):
    def test_duration_to_seconds(self):
        self.assertEqual(duration_to_seconds("01:02:03"), 3723)
        self.assertEqual(duration_to_seconds("12:00:00"), 43200)
        self.assertEqual(duration_to_seconds("bad"), 0)

    def test_youtube_rss_eligible(self):
        self.assertTrue(youtube_rss_eligible("12:00:00"))
        self.assertFalse(youtube_rss_eligible("12:00:01"))
        self.assertFalse(youtube_rss_eligible("00:00:00"))

    def test_release_field(self):
        body = "**Title:** My Space\n**Duration:** 01:00:00\n"
        self.assertEqual(release_field(body, "Title"), "My Space")
        self.assertEqual(release_field(body, "Missing", "fallback"), "fallback")

    def test_release_metadata(self):
        body = "---\nMETADATA::DURATION::02:03:04\nMETADATA::SOURCE_ID::abc123\n"
        self.assertEqual(release_metadata(body, "DURATION"), "02:03:04")
        self.assertEqual(release_metadata(body, "SOURCE_ID"), "abc123")

    def test_has_asset_with_extension(self):
        assets = [{"name": "episode.mp3"}, {"name": "transcript.txt"}]
        self.assertTrue(has_asset_with_extension(assets, ".mp3"))
        self.assertFalse(has_asset_with_extension(assets, ".wav"))


if __name__ == "__main__":
    unittest.main()
