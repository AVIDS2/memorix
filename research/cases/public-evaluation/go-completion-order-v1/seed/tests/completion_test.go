package tests

import (
	"reflect"
	"testing"

	"example.com/go-completion-order-v1/pkg/completion"
)

func TestMergeCandidatesKeepsFirstSpellingAndOrder(t *testing.T) {
	got := completion.MergeCandidates(
		[]string{"Build", "test"},
		[]string{"build", "Lint", "TEST"},
	)
	want := []string{"Build", "test", "Lint"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}
