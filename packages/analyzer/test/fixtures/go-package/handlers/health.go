package handlers

// A DIFFERENT directory is a different package. `normalizePath` is not in scope
// here, so this call must resolve to nothing rather than reach across packages.
func Health(p string) string {
	return normalizePath(p)
}
