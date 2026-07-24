package completion

func MergeCandidates(defaults []string, requested []string) []string {
	return append(append([]string{}, defaults...), requested...)
}
