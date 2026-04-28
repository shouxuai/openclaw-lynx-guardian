// Package middleware mirrors backend/src/middleware.
package middleware

import (
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

var loopbackAddresses = map[string]struct{}{
	"127.0.0.1":        {},
	"::1":              {},
	"::ffff:127.0.0.1": {},
}

type loopbackGuard struct {
	trusted map[string]struct{}
}

// RequireLoopback mirrors middleware/localhost-only.ts.
func RequireLoopback(trustedProxyIPs []string) gin.HandlerFunc {
	trusted := map[string]struct{}{}
	for k := range loopbackAddresses {
		trusted[k] = struct{}{}
	}
	for _, raw := range trustedProxyIPs {
		addTrusted(trusted, raw)
	}
	if len(trustedProxyIPs) == 0 {
		for _, raw := range resolveLinuxGateways("/proc/net/route") {
			addTrusted(trusted, raw)
		}
	}
	guard := &loopbackGuard{trusted: trusted}

	return func(c *gin.Context) {
		if guard.isAllowed(c.Request) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"ok":      false,
			"message": "Local console only accepts loopback requests.",
		})
	}
}

func (g *loopbackGuard) isAllowed(r *http.Request) bool {
	candidate := remoteIP(r)
	if candidate == "" {
		return false
	}
	if _, ok := g.trusted[candidate]; ok {
		return true
	}
	if _, ok := g.trusted[normalizeAddress(candidate)]; ok {
		return true
	}
	return false
}

func remoteIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func normalizeAddress(addr string) string {
	trimmed := strings.TrimSpace(addr)
	if strings.HasPrefix(trimmed, "::ffff:") {
		return trimmed[len("::ffff:"):]
	}
	return trimmed
}

func addTrusted(set map[string]struct{}, candidate string) {
	normalized := normalizeAddress(candidate)
	if normalized == "" {
		return
	}
	set[normalized] = struct{}{}
	if ip := net.ParseIP(normalized); ip != nil && ip.To4() != nil {
		set["::ffff:"+normalized] = struct{}{}
	}
}

// resolveLinuxGateways mirrors resolveTrustedProxyIps by reading /proc/net/route.
func resolveLinuxGateways(routeTablePath string) []string {
	data, err := os.ReadFile(routeTablePath)
	if err != nil {
		return nil
	}
	return parseLinuxDefaultGatewayAddresses(string(data))
}

func parseLinuxDefaultGatewayAddresses(routeTable string) []string {
	seen := map[string]struct{}{}
	lines := strings.Split(routeTable, "\n")
	if len(lines) <= 1 {
		return nil
	}
	for _, line := range lines[1:] {
		cols := strings.Fields(line)
		if len(cols) < 3 {
			continue
		}
		destination := cols[1]
		gateway := cols[2]
		if destination != "00000000" || gateway == "00000000" {
			continue
		}
		if parsed := parseLinuxRouteGateway(gateway); parsed != "" {
			seen[parsed] = struct{}{}
		}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	return out
}

func parseLinuxRouteGateway(hex string) string {
	if len(hex) != 8 {
		return ""
	}
	octets := make([]string, 4)
	for i := 0; i < 4; i++ {
		octet := hex[i*2 : i*2+2]
		n, err := parseHexByte(octet)
		if err != nil {
			return ""
		}
		octets[3-i] = itoa(n)
	}
	return strings.Join(octets, ".")
}

func parseHexByte(s string) (int, error) {
	var n int
	for _, r := range s {
		var digit int
		switch {
		case r >= '0' && r <= '9':
			digit = int(r - '0')
		case r >= 'a' && r <= 'f':
			digit = int(r-'a') + 10
		case r >= 'A' && r <= 'F':
			digit = int(r-'A') + 10
		default:
			return 0, errInvalidHex
		}
		n = n*16 + digit
	}
	return n, nil
}

var errInvalidHex = &parseError{msg: "invalid hex byte"}

type parseError struct{ msg string }

func (e *parseError) Error() string { return e.msg }

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := [4]byte{}
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
