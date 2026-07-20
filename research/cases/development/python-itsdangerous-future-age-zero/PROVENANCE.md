# Source provenance

- Upstream repository: `https://github.com/pallets/itsdangerous`
- Pinned base: `672971d66a2ef9f85151e53283113f33d642dabd`
- License: BSD-3-Clause
- Historical policy source: upstream commit
  `c30678d19e37011890e2374cca04f7789e101793`, “don't allow timestamps from
  the future”.

The base repository and future-timestamp policy are real upstream artifacts.
The helper extraction in `transition.patch` is benchmark-authored: it moves the
age validation into a method but accidentally uses truthiness for `max_age`.
It is a controlled migration, not an upstream incident replay. The hidden test
checks the distinct strict-zero case so the public upstream test for a positive
age budget remains intact.
