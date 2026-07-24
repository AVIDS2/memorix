import unittest

from src.headers import merge_headers


class MergeHeadersTests(unittest.TestCase):
    def test_request_value_reuses_default_header_spelling_and_position(self) -> None:
        merged = merge_headers(
            {
                "X-Trace-Id": "from-default",
                "Accept": "application/json",
            },
            {
                "x-trace-id": "from-request",
                "Authorization": "Bearer token",
            },
        )

        self.assertEqual(
            merged,
            {
                "X-Trace-Id": "from-request",
                "Accept": "application/json",
                "Authorization": "Bearer token",
            },
        )
        self.assertEqual(list(merged), ["X-Trace-Id", "Accept", "Authorization"])


if __name__ == "__main__":
    unittest.main()
