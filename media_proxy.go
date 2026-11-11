package main

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

const (
	maxMediaURLLength = 8192
	maxMediaRedirects = 3
)

var (
	errInvalidMediaURL    = errors.New("invalid media URL")
	errTooManyRedirects   = errors.New("too many media redirects")
	errNoRedirectLocation = errors.New("media redirect had no destination")
	errBlockedRedirect    = errors.New("media redirect blocked")

	mediaOrigins = map[string]struct{}{
		"lookout.hackclub.com":        {},
		"lookout.hackclub-assets.com": {},
		"public.lapse-hackclub.link":  {},
	}

	mediaPathPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)^/api/media/[A-Za-z0-9_-]+/video\.(?:mp4|webm|mov)$`),
		regexp.MustCompile(`(?i)^/timelapses/[A-Za-z0-9_-]+/timelapse-[A-Za-z0-9_-]+\.(?:mp4|webm|mov)$`),
		regexp.MustCompile(`(?i)^/timelapses/[A-Za-z0-9_-]+/original-[A-Za-z0-9]+\.(?:mp4|webm|mov)$`),
	}

	r2HostSuffix  = ".r2.cloudflarestorage.com"
	r2PathPattern = regexp.MustCompile(
		`(?i)^/collapse/timelapses/[A-Za-z0-9_-]+/[^/]+$`,
	)

	forwardedMediaHeaders = []string{
		"Content-Type",
		"Content-Length",
		"Content-Range",
		"Accept-Ranges",
		"ETag",
		"Last-Modified",
	}
)

type mediaProxy struct {
	client *http.Client
}

func newMediaProxy(client *http.Client) *mediaProxy {
	copied := *client
	copied.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}

	return &mediaProxy{client: &copied}
}

// parseMediaURL validates the URL supplied by the browser. Only the known Lapse video origins and paths are accepted.
func parseMediaURL(raw string) (*url.URL, error) {
	if raw == "" || len(raw) > maxMediaURLLength {
		return nil, errInvalidMediaURL
	}

	target, err := url.Parse(raw)
	if err != nil || !validMediaURLParts(target) {
		return nil, errInvalidMediaURL
	}

	if !isMediaOrigin(target.Hostname()) || !matchesMediaPath(target.EscapedPath()) {
		return nil, errInvalidMediaURL
	}

	return target, nil
}

// parseMediaRedirect validates a Location header and resolves it against the URL that produced the redirect. Older recordings may still point at a public R2 host.
func parseMediaRedirect(location string, base *url.URL) (*url.URL, error) {
	reference, err := url.Parse(location)
	if err != nil {
		return nil, errBlockedRedirect
	}

	target := base.ResolveReference(reference)
	if !validMediaURLParts(target) {
		return nil, errBlockedRedirect
	}

	host := strings.ToLower(target.Hostname())
	if isMediaOrigin(host) {
		if !matchesMediaPath(target.EscapedPath()) {
			return nil, errBlockedRedirect
		}

		return target, nil
	}

	if strings.HasSuffix(host, r2HostSuffix) && r2PathPattern.MatchString(target.EscapedPath()) {
		return target, nil
	}

	return nil, errBlockedRedirect
}

func validMediaURLParts(target *url.URL) bool {
	return target != nil &&
		target.Scheme == "https" &&
		target.Host != "" &&
		target.User == nil &&
		target.Port() == "" &&
		target.Fragment == ""
}

func isMediaOrigin(host string) bool {
	_, ok := mediaOrigins[strings.ToLower(host)]
	return ok
}

func matchesMediaPath(path string) bool {
	for _, pattern := range mediaPathPatterns {
		if pattern.MatchString(path) {
			return true
		}
	}

	return false
}

func (p *mediaProxy) handle(w http.ResponseWriter, r *http.Request) {
	target, err := parseMediaURL(r.URL.Query().Get("url"))
	if err != nil {
		http.Error(w, "Invalid media URL", http.StatusBadRequest)
		return
	}

	upstream, err := p.fetchMedia(r.Context(), target, r, 0)
	if err != nil {
		http.Error(w, mediaErrorMessage(err), http.StatusBadGateway)
		return
	}
	defer upstream.Body.Close()

	if !isVideoResponse(upstream) {
		http.Error(w, "Media upstream returned a non-video response", http.StatusBadGateway)
		return
	}

	for _, name := range forwardedMediaHeaders {
		if value := upstream.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}

	if upstream.StatusCode == http.StatusOK ||
		upstream.StatusCode == http.StatusPartialContent ||
		upstream.StatusCode == http.StatusNotModified {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}

	w.WriteHeader(upstream.StatusCode)

	if upstream.StatusCode == http.StatusNotModified {
		return
	}

	if _, err := copyResponseBody(w, upstream.Body); err != nil && r.Context().Err() == nil {
		log.Printf("lapse-proxy: copying response: %v", err)
	}
}

// copyResponseBody writes src to dst, tolerating the short writes the WASI HTTP adapter can return while its response stream is still accepting data.
func copyResponseBody(dst io.Writer, src io.Reader) (int64, error) {
	buffer := make([]byte, 32*1024)

	var total int64

	for {
		read, readErr := src.Read(buffer)
		if read > 0 {
			written := 0
			for written < read {
				count, writeErr := dst.Write(buffer[written:read])
				total += int64(count)
				written += count

				if writeErr != nil {
					return total, writeErr
				}

				if count == 0 {
					return total, io.ErrShortWrite
				}
			}
		}

		if errors.Is(readErr, io.EOF) {
			return total, nil
		}

		if readErr != nil {
			return total, readErr
		}
	}
}

func (p *mediaProxy) fetchMedia(
	ctx context.Context,
	target *url.URL,
	r *http.Request,
	redirects int,
) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, r.Method, target.String(), nil)
	if err != nil {
		return nil, err
	}

	request.Header = upstreamHeaders(r)

	response, err := p.client.Do(request)
	if err != nil {
		return nil, err
	}

	if !isRedirect(response.StatusCode) {
		return response, nil
	}

	if redirects >= maxMediaRedirects {
		_ = response.Body.Close()
		return nil, errTooManyRedirects
	}

	location := response.Header.Get("Location")
	_ = response.Body.Close()

	if location == "" {
		return nil, errNoRedirectLocation
	}

	next, err := parseMediaRedirect(location, target)
	if err != nil {
		return nil, err
	}

	return p.fetchMedia(ctx, next, r, redirects+1)
}

func upstreamHeaders(r *http.Request) http.Header {
	headers := make(http.Header)
	headers.Set("Accept", "*/*")
	headers.Set("User-Agent", "Peaks/1.0")

	if value := r.Header.Get("Range"); value != "" {
		headers.Set("Range", value)
		return headers
	}

	if value := r.Header.Get("If-None-Match"); value != "" {
		headers.Set("If-None-Match", value)
	}

	if value := r.Header.Get("If-Modified-Since"); value != "" {
		headers.Set("If-Modified-Since", value)
	}

	return headers
}

func isRedirect(status int) bool {
	switch status {
	case http.StatusMovedPermanently,
		http.StatusFound,
		http.StatusSeeOther,
		http.StatusTemporaryRedirect,
		http.StatusPermanentRedirect:
		return true
	}

	return false
}

func isVideoResponse(response *http.Response) bool {
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		return true
	}

	contentType := strings.ToLower(strings.TrimSpace(
		strings.SplitN(response.Header.Get("Content-Type"), ";", 2)[0],
	))

	return strings.HasPrefix(contentType, "video/")
}

func mediaErrorMessage(err error) string {
	switch {
	case errors.Is(err, errTooManyRedirects):
		return "Too many media redirects"
	case errors.Is(err, errNoRedirectLocation):
		return "Media redirect had no destination"
	case errors.Is(err, errBlockedRedirect):
		return "Media redirect blocked"
	default:
		return "Unable to fetch media"
	}
}
