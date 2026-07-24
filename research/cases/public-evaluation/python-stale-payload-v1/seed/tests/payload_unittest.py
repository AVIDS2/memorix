import unittest

from src.payload import clean_payload


class CleanPayloadTests(unittest.TestCase):
    def test_current_api_omits_none_values_but_keeps_falsey_values(self) -> None:
        self.assertEqual(
            clean_payload({"name": "memorix", "retries": 0, "enabled": False, "note": None}),
            {"name": "memorix", "retries": 0, "enabled": False},
        )


if __name__ == "__main__":
    unittest.main()
