package backoff

type Config struct {
	InitialMS int
	MaxMS     int
	Jitter    string
}

func MergeBackoff(defaults Config, override Config) Config {
	return override
}
