package health

func Check(timeoutMs int) bool {
	return timeoutMs > 0
}
