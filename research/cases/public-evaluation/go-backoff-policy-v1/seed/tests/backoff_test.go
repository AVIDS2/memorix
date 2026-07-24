package tests

import (
	"testing"

	"example.com/go-backoff-policy-v1/pkg/backoff"
)

func TestMergeBackoffInheritsUnsetValues(t *testing.T) {
	got := backoff.MergeBackoff(
		backoff.Config{InitialMS: 100, MaxMS: 2_000, Jitter: "full"},
		backoff.Config{InitialMS: 250},
	)
	want := backoff.Config{InitialMS: 250, MaxMS: 2_000, Jitter: "full"}
	if got != want {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}
