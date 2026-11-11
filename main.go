package main

import (
	"net/http"
)

// newHandler wires the app's routes. The media proxy takes its HTTP client from the caller so host tests can use a fake transport and the wasm build can use wasi:http.
func newHandler(client *http.Client) http.Handler {
	proxy := newMediaProxy(client)
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", health)
	mux.HandleFunc("HEAD /healthz", health)
	mux.HandleFunc("GET /lapse-proxy", proxy.handle)
	mux.HandleFunc("HEAD /lapse-proxy", proxy.handle)

	return mux
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func main() {}
