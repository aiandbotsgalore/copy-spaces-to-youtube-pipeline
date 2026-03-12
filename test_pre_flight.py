import unittest

from scripts.pre_flight import classify_failure


class ClassifyFailureTests(unittest.TestCase):
    def test_twitter_space_not_found_is_permanent(self):
        stderr = "ERROR: [twitter:spaces] 1rmGPkaMMNEKN: Twitter Space not found"
        self.assertEqual(classify_failure(stderr), "permanent")

    def test_replay_disabled_is_permanent(self):
        stderr = "ERROR: Twitter Space ended and replay is disabled"
        self.assertEqual(classify_failure(stderr), "permanent")

    def test_network_timeout_is_transient(self):
        stderr = "ERROR: Unable to download webpage: The read operation timed out"
        self.assertEqual(classify_failure(stderr), "transient")


if __name__ == "__main__":
    unittest.main()
