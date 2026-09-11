package handlers

import "example.com/shop"

// Health calls into the root package through a qualified import binding.
func Health(p string) string {
	return shop.Run(p)
}

// normalizePath is not in scope here — a bare call must not reach the parent dir.
func Broken(p string) string {
	return normalizePath(p)
}
