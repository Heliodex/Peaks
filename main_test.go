package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const (
	lookoutVideoURL = "https://lookout.hackclub.com/api/media/7e3d670e-28a0-465c-8747-73fc50ef44c7/video.mp4"
	legacyVideoURL  = "https://public.lapse-hackclub.link/timelapses/pgigZC4HUf6P/timelapse-pgigZC4HUf6P.mp4"
	lapseLegacyURL  = "https://lapse-legacy.hackclub-assets.com/timelapses/p7lHPSrXIDkD/timelapse-p7lHPSrXIDkD.mp4"
	lookoutAssetURL = "https://lookout.hackclub-assets.com/timelapses/7e3d670e-28a0-465c-8747-73fc50ef44c7/original-ff41fe17601ec9b75be7a80b135e2e35.mp4"
	r2VideoURL      = "https://f8d710a55cb9b516d88635f103c2c9f2.r2.cloudflarestorage.com/collapse/timelapses/7e3d670e-28a0-465c-8747-73fc50ef44c7/original-video.mp4?signature=test"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func fakeResponse(status int, body string, headers map[string]string) *http.Response {
	header := make(http.Header)
	for key, value := range headers {
		header.Set(key, value)
	}

	return &http.Response{
		StatusCode: status,
		Header:     header,
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func testHandler(roundTrip roundTripFunc) http.Handler {
	return newHandler(&http.Client{Transport: roundTrip})
}

func proxyRequest(rawURL string) string {
	return "/lapse-proxy?url=" + url.QueryEscape(rawURL)
}

func TestParseMediaURL(t *testing.T) {
	valid := []string{
		lookoutVideoURL,
		legacyVideoURL,
		lapseLegacyURL,
		lookoutAssetURL,
		lookoutVideoURL + "?cache=1",
	}

	for _, raw := range valid {
		if _, err := parseMediaURL(raw); err != nil {
			t.Errorf("parseMediaURL(%q) returned %v, want nil", raw, err)
		}
	}

	invalid := []string{
		"",
		"http://lookout.hackclub.com/api/media/id/video.mp4",
		"https://example.com/api/media/id/video.mp4",
		"https://lookout.hackclub.com/api/media/id/thumbnail.jpg",
		"https://lookout.hackclub.com/api/media/id/video.mp4/extra",
		"https://user:password@lookout.hackclub.com/api/media/id/video.mp4",
		"https://lookout.hackclub.com:8443/api/media/id/video.mp4",
		"https://lookout.hackclub.com/api/media/id/video.mp4#fragment",
		r2VideoURL,
		strings.Repeat("a", maxMediaURLLength+1),
	}

	for _, raw := range invalid {
		if _, err := parseMediaURL(raw); err == nil {
			t.Errorf("parseMediaURL(%q) returned nil, want an error", raw)
		}
	}
}

func TestParseMediaRedirect(t *testing.T) {
	base, err := parseMediaURL(lookoutVideoURL)
	if err != nil {
		t.Fatal(err)
	}

	valid := []string{
		lookoutAssetURL,
		legacyVideoURL,
		r2VideoURL,
		"/api/media/7e3d670e-28a0-465c-8747-73fc50ef44c7/video.mp4",
	}

	for _, raw := range valid {
		if _, err := parseMediaRedirect(raw, base); err != nil {
			t.Errorf("parseMediaRedirect(%q) returned %v, want nil", raw, err)
		}
	}

	invalid := []string{
		"https://example.com/video.mp4",
		"https://127.0.0.1/video.mp4",
		"https://attacker.r2.cloudflarestorage.com/other/video.mp4",
		"https://lookout.hackclub-assets.com/other/video.mp4",
		"http://lookout.hackclub.com/api/media/id/video.mp4",
		"https://user:password@lookout.hackclub.com/api/media/id/video.mp4",
		"https://lookout.hackclub.com:8443/api/media/id/video.mp4",
	}

	for _, raw := range invalid {
		if _, err := parseMediaRedirect(raw, base); err == nil {
			t.Errorf("parseMediaRedirect(%q) returned nil, want an error", raw)
		}
	}
}

func TestHealth(t *testing.T) {
	handler := newHandler(&http.Client{})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
}

func TestHandlerRejectsMissingAndInvalidURLs(t *testing.T) {
	handler := newHandler(&http.Client{})

	for _, path := range []string{
		"/lapse-proxy",
		proxyRequest("https://example.com/video.mp4"),
	} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))

		if recorder.Code != http.StatusBadRequest {
			t.Errorf("GET %s status = %d, want %d", path, recorder.Code, http.StatusBadRequest)
		}
	}
}

func TestHandlerForwardsRange(t *testing.T) {
	var upstream *http.Request

	handler := testHandler(func(r *http.Request) (*http.Response, error) {
		upstream = r

		return fakeResponse(http.StatusPartialContent, "video-bytes", map[string]string{
			"Accept-Ranges":  "bytes",
			"Content-Length": "11",
			"Content-Range":  "bytes 0-10/11",
			"Content-Type":   "video/mp4; charset=binary",
			"ETag":           `"etag"`,
			"Last-Modified":  "Wed, 21 Oct 2015 07:28:00 GMT",
		}), nil
	})

	request := httptest.NewRequest(http.MethodGet, proxyRequest(lookoutVideoURL), nil)
	request.Header.Set("Range", "bytes=0-1023")
	request.Header.Set("If-None-Match", `"etag"`)

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if upstream == nil {
		t.Fatal("upstream request was never made")
	}

	if got := upstream.Header.Get("Range"); got != "bytes=0-1023" {
		t.Errorf("upstream Range = %q, want %q", got, "bytes=0-1023")
	}

	if got := upstream.Header.Get("If-None-Match"); got != "" {
		t.Errorf("upstream If-None-Match = %q, want empty", got)
	}

	if recorder.Code != http.StatusPartialContent {
		t.Errorf("status = %d, want %d", recorder.Code, http.StatusPartialContent)
	}

	if got := recorder.Body.String(); got != "video-bytes" {
		t.Errorf("body = %q, want %q", got, "video-bytes")
	}

	if got := recorder.Header().Get("Content-Range"); got != "bytes 0-10/11" {
		t.Errorf("Content-Range = %q", got)
	}

	if got := recorder.Header().Get("Content-Type"); got != "video/mp4; charset=binary" {
		t.Errorf("Content-Type = %q, want video/mp4; charset=binary", got)
	}

	if got := recorder.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
}

func TestHandlerForwardsConditionalHeadersWithoutRange(t *testing.T) {
	var upstream *http.Request

	handler := testHandler(func(r *http.Request) (*http.Response, error) {
		upstream = r

		return fakeResponse(http.StatusOK, "video", map[string]string{
			"Content-Type": "video/mp4",
		}), nil
	})

	request := httptest.NewRequest(http.MethodGet, proxyRequest(lookoutVideoURL), nil)
	request.Header.Set("If-None-Match", `"etag"`)
	request.Header.Set("If-Modified-Since", "Wed, 21 Oct 2015 07:28:00 GMT")

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if got := upstream.Header.Get("If-None-Match"); got != `"etag"` {
		t.Errorf("upstream If-None-Match = %q", got)
	}

	if got := upstream.Header.Get("If-Modified-Since"); got != "Wed, 21 Oct 2015 07:28:00 GMT" {
		t.Errorf("upstream If-Modified-Since = %q", got)
	}

	if recorder.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
}

func TestHandlerFollowsAllowedRedirect(t *testing.T) {
	calls := 0

	handler := testHandler(func(r *http.Request) (*http.Response, error) {
		calls++

		switch calls {
		case 1:
			if got := r.URL.String(); got != lookoutVideoURL {
				t.Errorf("first request = %q, want %q", got, lookoutVideoURL)
			}

			return fakeResponse(http.StatusFound, "", map[string]string{
				"Location": lookoutAssetURL,
			}), nil
		case 2:
			if got := r.URL.String(); got != lookoutAssetURL {
				t.Errorf("second request = %q, want %q", got, lookoutAssetURL)
			}

			if got := r.Header.Get("Range"); got != "bytes=0-1" {
				t.Errorf("redirected Range = %q, want bytes=0-1", got)
			}

			return fakeResponse(http.StatusPartialContent, "asset", map[string]string{
				"Content-Type": "video/mp4",
			}), nil
		default:
			t.Fatalf("unexpected request %d to %s", calls, r.URL)
			return fakeResponse(http.StatusInternalServerError, "", nil), nil
		}
	})

	request := httptest.NewRequest(http.MethodGet, proxyRequest(lookoutVideoURL), nil)
	request.Header.Set("Range", "bytes=0-1")

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusPartialContent {
		t.Errorf("status = %d, want %d", recorder.Code, http.StatusPartialContent)
	}

	if got := recorder.Body.String(); got != "asset" {
		t.Errorf("body = %q, want asset", got)
	}

	if calls != 2 {
		t.Errorf("calls = %d, want 2", calls)
	}
}

func TestHandlerBlocksDisallowedRedirect(t *testing.T) {
	handler := testHandler(func(_ *http.Request) (*http.Response, error) {
		return fakeResponse(http.StatusFound, "", map[string]string{
			"Location": "https://example.com/video.mp4",
		}), nil
	})

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, proxyRequest(lookoutVideoURL), nil),
	)

	if recorder.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want %d", recorder.Code, http.StatusBadGateway)
	}

	if !strings.Contains(recorder.Body.String(), "Media redirect blocked") {
		t.Errorf("body = %q, want a blocked-redirect message", recorder.Body.String())
	}
}

func TestHandlerStopsAfterTooManyRedirects(t *testing.T) {
	calls := 0

	handler := testHandler(func(_ *http.Request) (*http.Response, error) {
		calls++

		return fakeResponse(http.StatusFound, "", map[string]string{
			"Location": lookoutVideoURL,
		}), nil
	})

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, proxyRequest(lookoutVideoURL), nil),
	)

	if recorder.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want %d", recorder.Code, http.StatusBadGateway)
	}

	if calls != maxMediaRedirects+1 {
		t.Errorf("calls = %d, want %d", calls, maxMediaRedirects+1)
	}
}

func TestHandlerRejectsNonVideoResponse(t *testing.T) {
	handler := testHandler(func(_ *http.Request) (*http.Response, error) {
		return fakeResponse(http.StatusOK, "<html>not a video</html>", map[string]string{
			"Content-Type": "text/html; charset=utf-8",
		}), nil
	})

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, proxyRequest(lookoutVideoURL), nil),
	)

	if recorder.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want %d", recorder.Code, http.StatusBadGateway)
	}
}

func TestHandlerNotModifiedHasNoBody(t *testing.T) {
	handler := testHandler(func(_ *http.Request) (*http.Response, error) {
		return fakeResponse(http.StatusNotModified, "ignored", map[string]string{
			"ETag": `"etag"`,
		}), nil
	})

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, proxyRequest(lookoutVideoURL), nil),
	)

	if recorder.Code != http.StatusNotModified {
		t.Errorf("status = %d, want %d", recorder.Code, http.StatusNotModified)
	}

	if got := recorder.Body.String(); got != "" {
		t.Errorf("body = %q, want empty", got)
	}

	if got := recorder.Header().Get("ETag"); got != `"etag"` {
		t.Errorf("ETag = %q", got)
	}

	if got := recorder.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
}

func TestHandlerPassesThroughUpstreamErrors(t *testing.T) {
	handler := testHandler(func(_ *http.Request) (*http.Response, error) {
		return fakeResponse(http.StatusInternalServerError, "upstream error", map[string]string{
			"Content-Type": "text/plain",
		}), nil
	})

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, proxyRequest(lookoutVideoURL), nil),
	)

	if recorder.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}

	if got := recorder.Body.String(); got != "upstream error" {
		t.Errorf("body = %q, want upstream error", got)
	}

	if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
}

type shortWriteBuffer struct {
	data []byte
	max  int
}

func (w *shortWriteBuffer) Write(p []byte) (int, error) {
	count := min(len(p), w.max)
	w.data = append(w.data, p[:count]...)

	return count, nil
}

type zeroWriter struct{}

func (zeroWriter) Write([]byte) (int, error) {
	return 0, nil
}

func TestCopyResponseBodyHandlesShortWrites(t *testing.T) {
	dst := &shortWriteBuffer{max: 2}

	written, err := copyResponseBody(dst, strings.NewReader("abcdef"))
	if err != nil {
		t.Fatalf("copyResponseBody returned %v", err)
	}

	if written != 6 {
		t.Errorf("written = %d, want 6", written)
	}

	if got := string(dst.data); got != "abcdef" {
		t.Errorf("data = %q, want abcdef", got)
	}

	if _, err := copyResponseBody(zeroWriter{}, strings.NewReader("x")); err == nil {
		t.Error("copyResponseBody with a zero-write writer returned nil, want an error")
	}
}
