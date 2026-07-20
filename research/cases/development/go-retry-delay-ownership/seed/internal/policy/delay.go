package policy

import "time"

func ValidRetryDelay(delay time.Duration) bool {
    return delay > 0 && delay <= 30*time.Second
}
