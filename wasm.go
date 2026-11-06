//go:build wasip1

package main

import (
	"github.com/heliodex/better-deploy/wt/packages/v2/wasihttp"
)

// init is the only wasm-specific wiring: the app's routes and the wasi:http export.
func init() {
	wasihttp.Handle(newHandler(wasihttp.NewClient()).ServeHTTP)
}
