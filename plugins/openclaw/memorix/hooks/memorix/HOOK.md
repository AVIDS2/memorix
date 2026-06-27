---
name: memorix
description: Bridge OpenClaw lifecycle events into Memorix shared memory.
metadata:
  openclaw:
    events:
      - agent:bootstrap
      - command:new
      - command:reset
      - session:compact:before
      - session:compact:after
      - message:sent
      - gateway:shutdown
    requires:
      bins:
        - memorix
---

# Memorix

Captures OpenClaw lifecycle events into the local Memorix memory layer and can inject relevant workspace context during agent bootstrap.
