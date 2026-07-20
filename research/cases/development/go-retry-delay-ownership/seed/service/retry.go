package service

import (
    "time"

    "example.com/memorixbench/retrydelay/internal/policy"
)

func ScheduleRetry(delay time.Duration) time.Duration {
    if !policy.ValidRetryDelay(delay) {
        panic("invalid retry delay")
    }
    return delay
}
