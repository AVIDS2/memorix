package endpoint

func ResolveEndpoint(region string) string {
	return "/v1/" + region
}
