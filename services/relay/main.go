package main

import (
	"context"
	"encoding/json"
	"fmt"
	"golang.org/x/net/netutil"
	"iter"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/khatru"
	"fiatjaf.com/nostr/nip40"
	"fiatjaf.com/nostr/nip45/hyperloglog"
)

var buildID = "development"

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func newRelay(store *eventStore) *khatru.Relay {
	return newRelayWithBudgetClock(store, time.Now)
}

// Only the rate-limit clock is injectable; event expiry and socket deadlines
// continue to use real time. Production uses the wall clock above.
func newRelayWithBudgetClock(store *eventStore, now func() time.Time) *khatru.Relay {
	relay := khatru.NewRelay()
	// Own the storage lifecycle instead of starting an unjoinable expiration worker.
	relay.QueryStored = func(ctx context.Context, f nostr.Filter) iter.Seq[nostr.Event] {
		// NIP-77 reconciles the whole matching set, so it may read past the REQ page size.
		limit := 200
		if khatru.IsNegentropySession(ctx) {
			limit = maxCount
		}
		return store.queryStored(f, limit, khatru.IsInternalCall(ctx))
	}
	relay.Negentropy = true
	relay.StoreEvent = func(ctx context.Context, e nostr.Event) error { return store.SaveEvent(e) }
	relay.ReplaceEvent = func(ctx context.Context, e nostr.Event) error { _, err := store.ReplaceEvent(e); return err }
	relay.DeleteEvent = func(ctx context.Context, id nostr.ID) error { return store.DeleteEvent(id) }
	relay.AllowDeleting = func(ctx context.Context, target, deletion nostr.Event) bool {
		return target.PubKey == deletion.PubKey && target.Kind != 5
	}

	relay.Info.Name = "Napplet Space relay"
	relay.Info.Description = "Signed napplets and supporting Nostr events; title, description and topic search."
	relay.Info.Software = "https://pkg.go.dev/fiatjaf.com/nostr/khatru"
	relay.Info.Version = "space-services-1"
	relay.Info.SupportedNIPs = []any{1, 9, 11, 40, 42, 50, 70}
	relay.MaxMessageSize = 65536
	budgets := &connectionBudgets{values: make(map[*khatru.WebSocket]*connectionBudget), now: now}
	relay.OnDisconnect = budgets.forget
	relay.OnConnect = budgets.connect
	relay.OnEvent = func(ctx context.Context, e nostr.Event) (bool, string) {
		if store.moderation.blocked(e) {
			return true, "blocked: operator policy"
		}
		if !budgets.allow(ctx, true) {
			return true, "rate-limited: event budget exceeded"
		}
		if e.Kind == 5 && nip40.GetExpiration(e.Tags) >= 0 {
			return true, "invalid: deletion markers must not expire"
		}
		if err := store.check(); err != nil {
			return true, "error: " + err.Error()
		}
		if e.CreatedAt > nostr.Now()+600 || expired(e) {
			return true, "invalid: event timestamp"
		}
		if len(e.Tags) > 256 {
			return true, "invalid: too many tags"
		}
		return false, ""
	}
	relay.OnRequest = func(ctx context.Context, f nostr.Filter) (bool, string) {
		if !budgets.allow(ctx, false) {
			return true, "rate-limited: query budget exceeded"
		}
		if reject, msg := filterLimits(f); reject {
			return true, msg
		}
		if err := store.check(); err != nil {
			return true, "error: " + err.Error()
		}
		return false, ""
	}
	// NIP-45 answers use the same visibility as REQ: deleted, expired and blocked
	// events are never counted. Budgets are applied inside Count; see waitCount.
	relay.OnCount = func(ctx context.Context, f nostr.Filter) (bool, string) { return filterLimits(f) }
	relay.Count = func(ctx context.Context, f nostr.Filter) (uint32, error) {
		total, _, err := countEvents(ctx, store, budgets, []nostr.Filter{f}, -1)
		return total, err
	}
	relay.CountFilters = func(ctx context.Context, filters []nostr.Filter) (uint32, error) {
		total, _, err := countEvents(ctx, store, budgets, filters, -1)
		return total, err
	}
	relay.CountHLL = func(ctx context.Context, f nostr.Filter, offset int) (uint32, *hyperloglog.HyperLogLog, error) {
		return countEvents(ctx, store, budgets, []nostr.Filter{f}, offset)
	}
	relay.PreventBroadcast = func(ws *khatru.WebSocket, f nostr.Filter, e nostr.Event) bool {
		if store.moderation.blocked(e) {
			return true
		}
		if f.Search == "" {
			return false
		}
		for stored := range store.QueryEvents(nostr.Filter{IDs: []nostr.ID{e.ID}, Search: f.Search}, 1) {
			if stored.ID == e.ID {
				return false
			}
		}
		return true
	}
	return relay
}
func filterLimits(f nostr.Filter) (bool, string) {
	if len(f.Search) > 256 || len(f.IDs) > 64 || len(f.Authors) > 64 || len(f.Kinds) > 32 || len(f.Tags) > 16 {
		return true, "restricted: filter exceeds service limits"
	}
	for key, values := range f.Tags {
		if len(key) != 1 || !(key[0] >= 'a' && key[0] <= 'z' || key[0] >= 'A' && key[0] <= 'Z') || len(values) > 64 {
			return true, "restricted: invalid tag filter"
		}
	}
	return false, ""
}

// The most events a COUNT or NIP-77 session reads; larger sets report this cap.
const maxCount = 5000

func countEvents(ctx context.Context, store *eventStore, budgets *connectionBudgets, filters []nostr.Filter, offset int) (uint32, *hyperloglog.HyperLogLog, error) {
	if !budgets.waitCount(ctx) {
		return 0, nil, fmt.Errorf("rate-limited: count budget exceeded")
	}
	if err := store.check(); err != nil {
		return 0, nil, err
	}
	var hll *hyperloglog.HyperLogLog
	if offset >= 0 {
		hll = hyperloglog.New(offset)
	}
	seen := make(map[nostr.ID]struct{})
	for _, f := range filters {
		// COUNT ignores paging limits, including an explicit limit of zero.
		f.Limit, f.LimitZero = 0, false
		for e := range store.queryStored(f, maxCount, false) {
			if _, duplicate := seen[e.ID]; duplicate {
				continue
			}
			seen[e.ID] = struct{}{}
			if hll != nil {
				hll.Add(e.PubKey)
			}
			if len(seen) == maxCount {
				break
			}
		}
		if err := ctx.Err(); err != nil {
			return 0, nil, err
		}
		if len(seen) == maxCount {
			break
		}
	}
	if err := store.check(); err != nil {
		return 0, nil, err
	}
	return uint32(len(seen)), hll, nil
}

func main() {
	data := env("SPACE_SERVICE_DATA", ".local/services/relay")
	store, err := openStore(data)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	relay := newRelay(store)
	relay.Router().HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		if err := store.moderation.check(); err != nil {
			http.Error(w, err.Error(), 503)
			return
		}
		if err := store.check(); err != nil {
			http.Error(w, err.Error(), 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "service": "relay", "version": "space-services-1", "build": buildID, "instance": env("SPACE_SERVICE_INSTANCE", "napplet")})
	})
	relay.ServiceURL = env("SPACE_SERVICE_URL", "http://127.0.0.1:19347")
	tcp, err := net.Listen("tcp", env("SPACE_SERVICE_BIND", "127.0.0.1:19347"))
	if err != nil {
		log.Fatal(err)
	}
	listener := &trackedListener{Listener: netutil.LimitListener(tcp, 256), connections: make(map[*trackedConnection]struct{})}
	publicURL, err := url.Parse(relay.ServiceURL)
	if err != nil || publicURL.Host == "" || (publicURL.Scheme != "http" && publicURL.Scheme != "https") {
		log.Fatal("SPACE_SERVICE_URL must be an HTTP(S) relay URL")
	}
	handler, err := relayRoutes(relay, listener.Addr().String(), env("SPACE_SERVICE_ALIASES", ""))
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	// Aggregate CVM replies need a separate bounded budget. This ingress never
	// appears in Caddy and rejects browser Origin headers, including localhost.
	var serviceServer *http.Server
	var serviceListener *trackedListener
	if bind := os.Getenv("SPACE_SERVICE_CVM_BIND"); bind != "" {
		host, _, err := net.SplitHostPort(bind)
		if err != nil || (host != "127.0.0.1" && host != "::1") {
			log.Fatal("CVM relay ingress must bind literal loopback")
		}
		socket, err := net.Listen("tcp", bind)
		if err != nil {
			log.Fatal(err)
		}
		serviceListener = &trackedListener{Listener: netutil.LimitListener(socket, 16), connections: make(map[*trackedConnection]struct{})}
		serviceServer = &http.Server{Handler: serviceRelayHandler(relay.WithServiceURL("http://" + serviceListener.Addr().String())), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	var maintenance sync.WaitGroup
	maintenance.Add(1)
	go func() {
		defer maintenance.Done()
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := store.purgeExpired(); err != nil {
					log.Printf("expiration cleanup: %s", err)
				}
			}
		}
	}()
	finished := make(chan error, 2)
	go func() { finished <- server.Serve(listener) }()
	if serviceServer != nil {
		go func() { finished <- serviceServer.Serve(serviceListener) }()
	}
	fmt.Printf("Napplet relay listening on http://%s\n", listener.Addr())
	select {
	case <-ctx.Done():
	case err := <-finished:
		if err != http.ErrServerClosed {
			log.Printf("relay stopped: %s", err)
		}
		stop()
	}
	grace, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server.Shutdown(grace)
	listener.closeConnections()
	if serviceServer != nil {
		serviceServer.Shutdown(grace)
		serviceListener.closeConnections()
	}
	maintenance.Wait()
}

func serviceRelayHandler(relay http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != "" {
			http.Error(w, "service ingress", http.StatusForbidden)
			return
		}
		relay.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), serviceIngressKey{}, true)))
	})
}
