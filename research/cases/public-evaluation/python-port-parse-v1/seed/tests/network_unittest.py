import unittest

from src.network import parse_port


class ParsePortTests(unittest.TestCase):
    def test_accepts_only_decimal_ports_in_range(self) -> None:
        self.assertEqual(parse_port("8080"), 8080)
        self.assertEqual(parse_port("1"), 1)
        self.assertEqual(parse_port("65535"), 65535)
        self.assertIsNone(parse_port(""))
        self.assertIsNone(parse_port(" 8080"))
        self.assertIsNone(parse_port("80/tcp"))
        self.assertIsNone(parse_port("0"))
        self.assertIsNone(parse_port("65536"))


if __name__ == "__main__":
    unittest.main()
