package shop

// Run is exported so handlers in another directory can call it through an import.
func Run(path string) string {
	clean := normalizePath(path)
	debugPrint(clean)
	return clean
}

type Engine struct{}

func (e *Engine) Reset() {
	debugPrint("engine reset")
}
