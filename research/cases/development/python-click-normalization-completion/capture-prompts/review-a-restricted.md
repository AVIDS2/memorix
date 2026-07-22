Read only these source areas: `src/click/core.py` around the Context token
normalization methods and command completion, `src/click/parser.py` around
option normalization, `src/click/shell_completion.py` around incomplete option
handling, and `tests/test_shell_completion.py` around token normalization.

Do not inspect other files. Do not edit code. Return exactly three bullets,
under 80 words total, with no code or repair steps:

- what reaches `token_normalize_func` for an option;
- what completion must compare versus return;
- one cross-module invariant a refactor must retain.
