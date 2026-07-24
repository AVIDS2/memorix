import unittest

from src.paging import clamp_limit


class ClampLimitTests(unittest.TestCase):
    def test_clamps_below_and_above_the_inclusive_range(self) -> None:
        self.assertEqual(clamp_limit(1, 5, 50), 5)
        self.assertEqual(clamp_limit(120, 5, 50), 50)
        self.assertEqual(clamp_limit(20, 5, 50), 20)


if __name__ == "__main__":
    unittest.main()
