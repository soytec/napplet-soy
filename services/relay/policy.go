package main

import (
	"context"
	"sync"
	"time"

	"fiatjaf.com/nostr/khatru"
)

type connectionBudget struct {
	minute                   int64
	requests, events, counts int
	countWaiters             int
	service                  bool
}
type serviceIngressKey struct{}
type connectionBudgets struct {
	sync.Mutex
	values map[*khatru.WebSocket]*connectionBudget
	now    func() time.Time
}

func (b *connectionBudgets) allow(ctx context.Context, publish bool) bool {
	ws := khatru.GetConnection(ctx)
	if ws == nil {
		return true
	}
	b.Lock()
	defer b.Unlock()
	minute := b.now().Unix() / 60
	q := b.values[ws]
	if q == nil {
		return false
	}
	if q.minute != minute {
		q = &connectionBudget{minute: minute, service: q.service}
		b.values[ws] = q
	}
	if publish {
		q.events++
		if q.service {
			return q.events <= 6000
		}
		return q.events <= 120
	}
	q.requests++
	if q.service {
		return q.requests <= 12000
	}
	return q.requests <= 240
}
func (b *connectionBudgets) forget(ctx context.Context) {
	b.Lock()
	defer b.Unlock()
	delete(b.values, khatru.GetConnection(ctx))
}

func (b *connectionBudgets) connect(ctx context.Context) {
	b.Lock()
	defer b.Unlock()
	// Khatru starts its socket context from Background; the original HTTP
	// request retains the private listener marker. It is never a client header.
	service, _ := khatru.GetConnection(ctx).Request.Context().Value(serviceIngressKey{}).(bool)
	b.values[khatru.GetConnection(ctx)] = &connectionBudget{minute: b.now().Unix() / 60, service: service}
}

// COUNT has no refusal frame in khatru: a rejected or failed COUNT becomes a
// NOTICE followed by a zero. Over-budget clients wait for the next window so a
// rate limit is never read as a real zero; only a backlog of waiters is refused.
func (b *connectionBudgets) waitCount(ctx context.Context) bool {
	ws := khatru.GetConnection(ctx)
	if ws == nil {
		return true
	}
	waiting := false
	defer func() {
		if waiting {
			b.Lock()
			if q := b.values[ws]; q != nil {
				q.countWaiters--
			}
			b.Unlock()
		}
	}()
	for {
		b.Lock()
		q := b.values[ws]
		if q == nil {
			b.Unlock()
			return false
		}
		minute := b.now().Unix() / 60
		if q.minute != minute {
			*q = connectionBudget{minute: minute, service: q.service, countWaiters: q.countWaiters}
		}
		limit := 1200
		if q.service {
			limit = 24000
		}
		if q.counts < limit {
			q.counts++
			b.Unlock()
			return true
		}
		if !waiting {
			if q.countWaiters >= 32 {
				b.Unlock()
				return false
			}
			q.countWaiters++
			waiting = true
		}
		b.Unlock()
		select {
		case <-ctx.Done():
			return false
		case <-time.After(250 * time.Millisecond):
		}
	}
}
