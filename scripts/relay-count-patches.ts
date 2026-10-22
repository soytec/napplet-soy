// Compatibility fixes for the checksum-pinned khatru release. Keep these local
// until upstream handles COUNT refusals and multi-filter unions itself.
function replaceOnce(source: string, from: string, to: string) {
  if (source.split(from).length !== 2)
    throw new Error(
      'Pinned relay COUNT patch did not match exactly once. Review before upgrading.',
    );
  return source.replace(from, to);
}

export const countPatches = [
  {
    file: 'subscription.go',
    sha256: 'b5c726f30048044c787285a3362a447f9c32f10c9afef36e96f0a12719dc2738',
    apply: (source: string) =>
      replaceOnce(
        source,
        'CountEnvelope{sub.id, sub.Filter, nil, nil}',
        'CountEnvelope{SubscriptionID: sub.id, Filter: sub.Filter}',
      ),
  },
  {
    file: 'envelopes.go',
    sha256: 'bbbbf9cd7828cc07e3b9ead6f19b4b6b03d62eb89b0693a8fad855bfd2a71a7b',
    apply: (source: string) => {
      source = replaceOnce(
        source,
        'type CountEnvelope struct {\n',
        'type CountEnvelope struct {\n\tFilters []Filter\n',
      );
      source = replaceOnce(
        source,
        `
\titem := unsafe.Slice(unsafe.StringData(arr[2].Raw), len(arr[2].Raw))
\tif err := easyjson.Unmarshal(item, &v.Filter); err != nil {
\t\treturn fmt.Errorf("on filter: %w", err)
\t}
`,
        `
\tv.Filters = make([]Filter, len(arr)-2)
\tfor i, item := range arr[2:] {
\t\tif !item.IsObject() {
\t\t\treturn fmt.Errorf("on filter %d: expected an object", i)
\t\t}
\t\tif err := easyjson.Unmarshal([]byte(item.Raw), &v.Filters[i]); err != nil {
\t\t\treturn fmt.Errorf("on filter %d: %w", i, err)
\t\t}
\t}
\t// Preserve the embedded field for existing single-filter callers.
\tv.Filter = v.Filters[0]
`,
      );
      return replaceOnce(
        source,
        '\t\tv.Filter.MarshalEasyJSON(&w)\n',
        `\t\tif len(v.Filters) == 0 {
\t\t\tv.Filter.MarshalEasyJSON(&w)
\t\t} else {
\t\t\tfor i, filter := range v.Filters {
\t\t\t\tif i > 0 { w.RawByte(',') }
\t\t\t\tfilter.MarshalEasyJSON(&w)
\t\t\t}
\t\t}
`,
      );
    },
  },
  {
    file: 'khatru/relay.go',
    sha256: '31d8ca7b1d10b1845944d58e0054440287eaeaf14e072f74f7e7d9137c55331a',
    apply: (source: string) =>
      replaceOnce(
        source,
        '\tCount                     func(ctx context.Context, filter nostr.Filter) (uint32, error)\n',
        '\tCount                     func(ctx context.Context, filter nostr.Filter) (uint32, error)\n\tCountFilters              func(ctx context.Context, filters []nostr.Filter) (uint32, error)\n',
      ),
  },
  {
    file: 'khatru/handlers.go',
    sha256: '390dc5363edf012b843d675792ad941c1e43c6e218c53402d32bb15d1e80db4f',
    apply: (source: string) =>
      replaceOnce(
        source,
        `
\t\t\t\t\tif rl.Count == nil && rl.CountHLL == nil {
\t\t\t\t\t\tws.WriteJSON(nostr.ClosedEnvelope{SubscriptionID: env.SubscriptionID, Reason: "unsupported: this relay does not support NIP-45"})
\t\t\t\t\t\treturn
\t\t\t\t\t}

\t\t\t\t\tvar total uint32
\t\t\t\t\tvar hll *hyperloglog.HyperLogLog

\t\t\t\t\tif offset := nip45.HyperLogLogEventPubkeyOffsetForFilter(env.Filter); offset != -1 {
\t\t\t\t\t\ttotal, hll = rl.handleCountRequestWithHLL(ctx, ws, env.Filter, offset)
\t\t\t\t\t} else {
\t\t\t\t\t\ttotal = rl.handleCountRequest(ctx, ws, env.Filter)
\t\t\t\t\t}
`,
        `
\t\t\t\t\trefuse := func(reason string) {
\t\t\t\t\t\tws.WriteJSON(nostr.ClosedEnvelope{SubscriptionID: env.SubscriptionID, Reason: nostr.NormalizeOKMessage(reason, "error")})
\t\t\t\t\t}
\t\t\t\t\tif env.Count != nil {
\t\t\t\t\t\trefuse("invalid: expected COUNT filters, not a response")
\t\t\t\t\t\treturn
\t\t\t\t\t}
\t\t\t\t\t// Validate every filter before producing any result.
\t\t\t\t\tfor _, filter := range env.Filters {
\t\t\t\t\t\tif rl.OnCount != nil {
\t\t\t\t\t\t\tif reject, reason := rl.OnCount(ctx, filter); reject {
\t\t\t\t\t\t\t\trefuse(reason)
\t\t\t\t\t\t\t\treturn
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t\tvar total uint32
\t\t\t\t\tvar hll *hyperloglog.HyperLogLog
\t\t\t\t\tvar err error
\t\t\t\t\tif len(env.Filters) > 1 {
\t\t\t\t\t\tif rl.CountFilters == nil {
\t\t\t\t\t\t\trefuse("unsupported: multiple COUNT filters")
\t\t\t\t\t\t\treturn
\t\t\t\t\t\t}
\t\t\t\t\t\t// Count the union, not a sum that duplicates overlapping events.
\t\t\t\t\t\ttotal, err = rl.CountFilters(ctx, env.Filters)
\t\t\t\t\t} else if offset := nip45.HyperLogLogEventPubkeyOffsetForFilter(env.Filter); offset != -1 && rl.CountHLL != nil {
\t\t\t\t\t\ttotal, hll, err = rl.CountHLL(ctx, env.Filter, offset)
\t\t\t\t\t} else if rl.Count != nil {
\t\t\t\t\t\ttotal, err = rl.Count(ctx, env.Filter)
\t\t\t\t\t} else {
\t\t\t\t\t\trefuse("unsupported: this relay cannot count these filters")
\t\t\t\t\t\treturn
\t\t\t\t\t}
\t\t\t\t\tif err != nil {
\t\t\t\t\t\trefuse(err.Error())
\t\t\t\t\t\treturn
\t\t\t\t\t}
`,
      ),
  },
];
