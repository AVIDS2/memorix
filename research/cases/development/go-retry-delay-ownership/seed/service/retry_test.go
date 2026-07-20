package service

import (
    "testing"
    "time"
)

func TestAcceptsRetryDelay(t *testing.T) {
    if got := ScheduleRetry(5 * time.Second); got != 5*time.Second {
        t.Fatalf("unexpected delay: %s", got)
    }
}

func TestRejectsInvalidRetryDelay(t *testing.T) {
    for _, delay := range []time.Duration{
        0,
        31 * time.Second,
    } {
        if !panics(func() { ScheduleRetry(delay) }) {
            t.Fatalf("expected %s to panic", delay)
        }
    }
}

func panics(fn func()) (didPanic bool) {
    defer func() { didPanic = recover() != nil }()
    fn()
    return false
}
