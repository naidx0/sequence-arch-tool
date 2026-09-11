package store

// Load returns the profile for a named environment.
func Load(name string) string {
	return normalize(name)
}

func normalize(name string) string {
	if name == "" {
		return "default"
	}
	return name
}
