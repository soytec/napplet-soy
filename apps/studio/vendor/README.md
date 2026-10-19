# Offline OpenCode model catalogue

`models.json` contains the OpenRouter, OpenAI, Anthropic, Google and DeepSeek
records from the public models.dev catalogue used in the 2026-10-17 compatibility
experiment. This is OpenCode's offline provider metadata, not the Studio model
picker: the picker still queries the user's selected provider with their API key.

Original complete snapshot SHA-256:
`d4c6777c47b62c18eb501f1591ff77eb60222986bfe4a19af69f8d6d772a31b2`.
Committed subset SHA-256:
`f19be6176afb319bf787b8108aa0e7c4eec1522e677f54daf2383c04ab442145`.

Source: <https://models.dev/api.json>. MIT, copyright models.dev; see
[LICENSE.models.dev](LICENSE.models.dev). The worker image carries the attribution.
OpenCode's source tarball retains its own MIT license.

To update, download the public catalogue, select these five provider records,
record both hashes and the retrieval date here, then rebuild and run the isolated
agent/provider tests. Do not enable automatic network refresh inside jobs. Other
hosted cloud providers use the maintained OpenAI-compatible adapter and do not
need additional native catalogue records.
