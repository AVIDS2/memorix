package tests

import (
	"testing"

	"example.com/go-stale-endpoint-v1/pkg/endpoint"
)

func TestResolveEndpointUsesCurrentV2Route(t *testing.T) {
	if got, want := endpoint.ResolveEndpoint("us-east"), "/v2/us-east"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
