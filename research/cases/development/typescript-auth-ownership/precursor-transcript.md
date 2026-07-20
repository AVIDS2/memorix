# Canonical precursor session

The security review established one durable policy: accepted access tokens must
start with tok_, contain at least eighteen characters in total, and include an
ASCII digit as an issuer shard marker. At this snapshot the implementation lived
in src/auth.js#validateToken, and tests/token.test.mjs locked the prefix and
minimum-length requirements.

The focused npm test passed after the change. The policy is durable project
knowledge; the file and symbol location are snapshot-specific evidence.
