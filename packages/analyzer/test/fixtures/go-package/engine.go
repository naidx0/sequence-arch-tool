package shop

// Same package, different file: `normalizePath` and `debugPrint` live in
// router.go and are reachable here with NO import — that is Go's package scope,
// and it is why a Go library's call graph looked completely disconnected.
func Run(path string) string {
	clean := normalizePath(path)
	debugPrint(clean)
	return clean
}

type Engine struct{}

// A METHOD with the same name as a package-level function elsewhere. A bare
// `Reset(...)` must never resolve here — in Go a method is only reachable
// through its receiver.
func (e *Engine) Reset() {
	debugPrint("engine reset")
}
