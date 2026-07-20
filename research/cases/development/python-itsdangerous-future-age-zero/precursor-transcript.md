# Prior timestamp validation review

Temporal validation is enabled when `max_age` is supplied: `None` means no age
limit, while `0` is a strict limit rather than a false-like opt-out. A validly
signed value with a future timestamp must raise `SignatureExpired` under every
supplied age limit. At this point the direct checks are inside
`TimestampSigner.unsign`; that placement may change during refactoring.
