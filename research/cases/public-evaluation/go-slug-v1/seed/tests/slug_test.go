package tests

import (
	"testing"

	"example.com/go-slug-v1/pkg/slug"
)

func TestSlugNormalizesWhitespaceAndCase(t *testing.T) {
	if got, want := slug.Slug("  Memorix   Transfer  "), "memorix-transfer"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
