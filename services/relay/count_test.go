package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/nip77"
	"github.com/fasthttp/websocket"
)

func countRelay(t *testing.T, ws *websocket.Conn, id string, f nostr.Filter) (uint32, bool) {
	t.Helper()
	ws.WriteJSON([]any{"COUNT", id, f})
	for {
		msg := read(t, ws)
		switch string(msg[0]) {
		case `"COUNT"`:
			var body struct {
				Count uint32 `json:"count"`
				HLL   string `json:"hll"`
			}
			if err := json.Unmarshal(msg[2], &body); err != nil {
				t.Fatal(err)
			}
			return body.Count, body.HLL != ""
		case `"CLOSED"`, `"NOTICE"`:
			t.Fatalf("count refused: %s", msg)
		}
	}
}

func TestCountMatchesVisibleEvents(t *testing.T) {
	s := testStore(t)
	server := httptest.NewServer(newRelay(s))
	defer server.Close()
	ws := socket(t, server.URL)
	author := nostr.Generate()
	now := nostr.Now()
	napplet := fixture(t, author, 35129, now-10, nostr.Tags{{"d", "orbit"}, {"title", "Orbit"}}, "")
	publish(t, ws, napplet, true)
	address := "35129:" + napplet.PubKey.Hex() + ":orbit"
	var likers []nostr.SecretKey
	var likes []nostr.Event
	for i := 0; i < 4; i++ {
		liker := nostr.Generate()
		like := fixture(t, liker, 7, now-5, nostr.Tags{{"e", napplet.ID.Hex()}, {"a", address}}, "+")
		publish(t, ws, like, true)
		likers, likes = append(likers, liker), append(likes, like)
	}
	// An unlike is a NIP-09 deletion; the relay stops counting the reaction.
	publish(t, ws, fixture(t, likers[3], 5, now-4, nostr.Tags{{"e", likes[3].ID.Hex()}}, ""), true)
	byAddress := nostr.Filter{Kinds: []nostr.Kind{7}, Tags: nostr.TagMap{"a": {address}}}
	if got, _ := countRelay(t, ws, "a", byAddress); got != 3 {
		t.Fatalf("expected 3 likes by address, got %d", got)
	}
	// Kind-7 #e filters take khatru's HyperLogLog path, which answers 0 unless CountHLL is set.
	byEvent := nostr.Filter{Kinds: []nostr.Kind{7}, Tags: nostr.TagMap{"e": {napplet.ID.Hex()}}}
	got, hll := countRelay(t, ws, "e", byEvent)
	if got != 3 || !hll {
		t.Fatalf("expected 3 likes with HyperLogLog registers, got %d (hll %v)", got, hll)
	}
	// A COUNT limit is not a page size.
	limited := byAddress
	limited.Limit = 1
	if got, _ := countRelay(t, ws, "limit", limited); got != 3 {
		t.Fatalf("COUNT honored limit as a page size: %d", got)
	}
	expired := fixture(t, nostr.Generate(), 1111, now-4, nostr.Tags{{"A", address}, {"expiration", "1"}}, "late")
	publish(t, ws, expired, false)
	comment := fixture(t, nostr.Generate(), 1111, now-4, nostr.Tags{{"A", address}, {"K", "35129"}}, "hello")
	publish(t, ws, comment, true)
	if got, _ := countRelay(t, ws, "c", nostr.Filter{Kinds: []nostr.Kind{1111}, Tags: nostr.TagMap{"A": {address}}}); got != 1 {
		t.Fatalf("expected 1 comment, got %d", got)
	}
}

func TestNIP11AdvertisesCountAndNegentropy(t *testing.T) {
	server := httptest.NewServer(newRelay(testStore(t)))
	defer server.Close()
	req, _ := http.NewRequest("GET", server.URL, nil)
	req.Header.Set("Accept", "application/nostr+json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var info struct {
		SupportedNIPs []int `json:"supported_nips"`
	}
	if err = json.NewDecoder(res.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	found := map[int]bool{}
	for _, nip := range info.SupportedNIPs {
		found[nip] = true
	}
	if !found[45] || !found[77] {
		t.Fatalf("NIP-45 and NIP-77 not advertised: %v", info.SupportedNIPs)
	}
}

type discardPublisher struct{}

func (discardPublisher) Publish(context.Context, nostr.Event) error { return nil }

func TestNegentropyReconcilesPastRequestPageSize(t *testing.T) {
	s := testStore(t)
	server := httptest.NewServer(newRelay(s))
	defer server.Close()
	key := nostr.Generate()
	now := nostr.Now()
	// More than the 200-event REQ page, so a capped session would miss IDs.
	want := map[nostr.ID]bool{}
	for i := 0; i < 250; i++ {
		e := fixture(t, key, 5129, now-nostr.Timestamp(i), nostr.Tags{{"title", "snapshot"}}, string(rune('a'+i%26))+string(rune(i)))
		put(t, s, e)
		want[e.ID] = true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var mu sync.Mutex
	got := map[nostr.ID]bool{}
	err := nip77.NegentropySync(ctx, "ws"+server.URL[len("http"):], nostr.Filter{Kinds: []nostr.Kind{5129}}, nil, discardPublisher{},
		func(ctx context.Context, dir nip77.Direction) {
			for id := range dir.Items {
				mu.Lock()
				got[id] = true
				mu.Unlock()
			}
		})
	if err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != len(want) {
		t.Fatalf("negentropy reported %d of %d events", len(got), len(want))
	}
}

func TestCountWaitsForBudgetInsteadOfAnsweringZero(t *testing.T) {
	var seconds atomic.Int64
	seconds.Store(59)
	s := testStore(t)
	server := httptest.NewServer(newRelayWithBudgetClock(s, func() time.Time { return time.Unix(seconds.Load(), 0) }))
	defer server.Close()
	ws := socket(t, server.URL)
	key := nostr.Generate()
	napplet := fixture(t, key, 5129, nostr.Now(), nostr.Tags{{"title", "budget"}}, "")
	publish(t, ws, napplet, true)
	f := nostr.Filter{Kinds: []nostr.Kind{5129}, Authors: []nostr.PubKey{napplet.PubKey}}
	for i := 0; i < 1200; i++ {
		ws.WriteJSON([]any{"COUNT", "fill", f})
	}
	for i := 0; i < 1200; i++ {
		if msg := read(t, ws); string(msg[0]) != `"COUNT"` {
			t.Fatalf("expected COUNT within budget: %s", msg)
		}
	}
	ws.WriteJSON([]any{"COUNT", "over", f})
	answers := make(chan []json.RawMessage, 1)
	go func() {
		var msg []json.RawMessage
		ws.SetReadDeadline(time.Now().Add(10 * time.Second))
		if ws.ReadJSON(&msg) == nil {
			answers <- msg
		}
		close(answers)
	}()
	select {
	case msg := <-answers:
		t.Fatalf("over-budget COUNT answered before the next window: %s", msg)
	case <-time.After(600 * time.Millisecond):
	}
	seconds.Store(60)
	msg, ok := <-answers
	if !ok || string(msg[0]) != `"COUNT"` || string(msg[1]) != `"over"` {
		t.Fatalf("expected the delayed COUNT, got %s", msg)
	}
	var body struct {
		Count uint32 `json:"count"`
	}
	if err := json.Unmarshal(msg[2], &body); err != nil || body.Count != 1 {
		t.Fatalf("expected the real count after the window, got %s", msg[2])
	}
}
