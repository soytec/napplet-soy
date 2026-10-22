package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"fiatjaf.com/nostr"
	"github.com/fasthttp/websocket"
)

func assertCountClosed(t *testing.T, ws *websocket.Conn, id, reason string) {
	t.Helper()
	msg := read(t, ws)
	if len(msg) != 3 || string(msg[0]) != `"CLOSED"` || string(msg[1]) != fmt.Sprintf("%q", id) || !strings.Contains(string(msg[2]), reason) {
		t.Fatalf("expected CLOSED for %s with %q, got %s", id, reason, msg)
	}
	// A healthy request must be the next response, not a false COUNT 0 for the
	// refused query. This catches NOTICE/CLOSED followed by a spurious result.
	if err := ws.WriteJSON([]any{"COUNT", "after-refusal", nostr.Filter{Kinds: []nostr.Kind{5129}}}); err != nil {
		t.Fatal(err)
	}
	msg = read(t, ws)
	if len(msg) != 3 || string(msg[0]) != `"COUNT"` || string(msg[1]) != `"after-refusal"` {
		t.Fatalf("unexpected response after refusal: %s", msg)
	}
}

func TestCountRejectedFilterClosesWholeRequest(t *testing.T) {
	for _, hll := range []bool{false, true} {
		for _, multiple := range []bool{false, true} {
			t.Run(fmt.Sprintf("hll=%v/multiple=%v", hll, multiple), func(t *testing.T) {
				relay := newRelay(testStore(t))
				bad := nostr.Filter{Tags: nostr.TagMap{"invalid": {"x"}}}
				if hll {
					// Force rejection of a canonical HLL filter too.
					bad = nostr.Filter{Kinds: []nostr.Kind{7}, Tags: nostr.TagMap{"e": {strings.Repeat("a", 64)}}}
					relay.OnCount = func(_ context.Context, f nostr.Filter) (bool, string) {
						return len(f.Tags) > 0, "restricted: test policy"
					}
				}
				server := httptest.NewServer(relay)
				defer server.Close()
				ws := socket(t, server.URL)
				request := []any{"COUNT", "refused"}
				if multiple {
					request = append(request, nostr.Filter{Kinds: []nostr.Kind{5129}})
				}
				request = append(request, bad)
				if err := ws.WriteJSON(request); err != nil {
					t.Fatal(err)
				}
				assertCountClosed(t, ws, "refused", "restricted:")
			})
		}
	}
}

func TestCountStorageFailureClosesRequest(t *testing.T) {
	for _, hll := range []bool{false, true} {
		t.Run(fmt.Sprintf("hll=%v", hll), func(t *testing.T) {
			s := testStore(t)
			relay := newRelay(s)
			server := httptest.NewServer(relay)
			defer server.Close()
			ws := socket(t, server.URL)
			s.mu.Lock()
			s.healthy = false
			s.mu.Unlock()
			f := nostr.Filter{Kinds: []nostr.Kind{5129}}
			if hll {
				f = nostr.Filter{Kinds: []nostr.Kind{7}, Tags: nostr.TagMap{"e": {strings.Repeat("a", 64)}}}
			}
			ws.WriteJSON([]any{"COUNT", "storage", f})
			msg := read(t, ws)
			if len(msg) != 3 || string(msg[0]) != `"CLOSED"` || string(msg[1]) != `"storage"` || !strings.Contains(string(msg[2]), "restart to rebuild") {
				t.Fatalf("expected actionable storage failure in CLOSED, got %s", msg)
			}
			s.mu.Lock()
			s.healthy = true
			s.mu.Unlock()
			// No queued false zero after storage recovers.
			ws.WriteJSON([]any{"COUNT", "recovered", f})
			msg = read(t, ws)
			if string(msg[0]) != `"COUNT"` || string(msg[1]) != `"recovered"` {
				t.Fatalf("unexpected response after recovery: %s", msg)
			}
		})
	}
}

func TestCountMultipleFiltersUseDeduplicatedUnion(t *testing.T) {
	s := testStore(t)
	key := nostr.Generate()
	first := fixture(t, key, 5129, nostr.Now(), nil, "first")
	second := fixture(t, key, 35129, nostr.Now(), nostr.Tags{{"d", "second"}}, "second")
	put(t, s, first)
	put(t, s, second)
	server := httptest.NewServer(newRelay(s))
	defer server.Close()
	ws := socket(t, server.URL)
	for _, filters := range [][]any{
		{map[string]any{"kinds": []int{5129}}, map[string]any{"kinds": []int{35129}}},
		{map[string]any{"kinds": []int{35129}}, map[string]any{"kinds": []int{5129}}},
		{map[string]any{"kinds": []int{5129, 35129}}, map[string]any{"authors": []string{first.PubKey.Hex()}}, map[string]any{}},
		{map[string]any{"kinds": []int{5129}, "limit": 1}, map[string]any{"kinds": []int{35129}, "limit": 0}},
	} {
		ws.WriteJSON(append([]any{"COUNT", "union"}, filters...))
		msg := read(t, ws)
		var body struct {
			Count uint32 `json:"count"`
			HLL   string `json:"hll"`
		}
		if len(msg) != 3 || string(msg[0]) != `"COUNT"` || json.Unmarshal(msg[2], &body) != nil || body.Count != 2 || body.HLL != "" {
			t.Fatalf("expected union count 2 without single-filter HLL, got %s for %v", msg, filters)
		}
	}
	if count, _ := countRelay(t, ws, "empty", nostr.Filter{Kinds: []nostr.Kind{7}}); count != 0 {
		t.Fatalf("a genuinely empty set should still count as zero: %d", count)
	}
}

func TestCountQueueOverflowClosesRequest(t *testing.T) {
	var seconds atomic.Int64
	seconds.Store(59)
	s := testStore(t)
	server := httptest.NewServer(newRelayWithBudgetClock(s, func() time.Time { return time.Unix(seconds.Load(), 0) }))
	defer server.Close()
	ws := socket(t, server.URL)
	f := nostr.Filter{Kinds: []nostr.Kind{5129}}
	for i := 0; i < 1200; i++ {
		ws.WriteJSON([]any{"COUNT", "fill", f})
	}
	for i := 0; i < 1200; i++ {
		if msg := read(t, ws); string(msg[0]) != `"COUNT"` {
			t.Fatalf("expected COUNT within budget: %s", msg)
		}
	}
	for i := 0; i < 33; i++ {
		ws.WriteJSON([]any{"COUNT", fmt.Sprintf("queued-%d", i), f})
	}
	msg := read(t, ws)
	if len(msg) != 3 || string(msg[0]) != `"CLOSED"` || !strings.Contains(string(msg[2]), "rate-limited: count budget exceeded") {
		t.Fatalf("expected CLOSED for queue overflow, got %s", msg)
	}
	refused := string(msg[1])
	seconds.Store(60)
	seen := map[string]bool{}
	for i := 0; i < 32; i++ {
		msg = read(t, ws)
		if len(msg) != 3 || string(msg[0]) != `"COUNT"` || string(msg[1]) == refused || seen[string(msg[1])] {
			t.Fatalf("expected unique delayed COUNT, got %s", msg)
		}
		seen[string(msg[1])] = true
	}
}
