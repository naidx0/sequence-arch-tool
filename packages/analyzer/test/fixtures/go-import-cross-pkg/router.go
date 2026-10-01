package shop

import "strings"

func normalizePath(p string) string {
	return strings.TrimSuffix(p, "/")
}

func debugPrint(msg string) {
	_ = msg
}
