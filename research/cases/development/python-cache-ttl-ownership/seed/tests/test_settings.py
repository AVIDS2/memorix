import unittest

from src.settings import build_settings


class SettingsTests(unittest.TestCase):
    def test_accepts_a_positive_ttl(self) -> None:
        self.assertEqual(build_settings(300), {"cache_ttl": 300})

    def test_rejects_invalid_ttls(self) -> None:
        for value in (0, -1):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    build_settings(value)
