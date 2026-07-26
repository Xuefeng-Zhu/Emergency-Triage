# Lane 3 (Agent & Governance) — open items

Working checklist for the remaining Lane C work. The core loop (pathway graph,
corpus-grounded consult, envelope gate, write-ahead audit) is built and tested
in stub mode; live-mode verification is tracked in
[lane3-live-testing.md](lane3-live-testing.md).

## Open

- [ ] **Live-model output defense.** Stub output is always well-formed; a live
      model is not. `Proposal.model_validate` currently 500s the whole consult
      on one malformed item, and nothing verifies a `citation` names a section
      that actually exists in the grounding slice. Needed: drop invalid items
      (with an audit row noting the drop), and a citation-exists check against
      the slice. This is a governance claim — "citations are verifiable" — not
      polish. (~1h)

- [ ] **Advisory debounce.** Rapid consecutive utterances should collapse to a
      single classification call (scope §8.2, third mitigation). Lives in
      `service.py`. Matters once real inference latency exists. (~30m)

- [ ] **Declared envelope surfacing.** `ORDER_ENVELOPE` is a hardcoded dict in
      `governance.py`. A `GET /envelope` endpoint would let the client show
      what the box is permitted to order — makes "declared envelope" visible
      rather than asserted. Additive for Lane A; their call whether to render
      it. (~20m)

## Done

- [x] Pathway graph (14 nodes, validated on load) + hint-keyed reference corpus
- [x] Advisory loop: label set derived from pathway file, node-catalog prompt
- [x] Consult loop: corpus slice grounding, citation format, intake fallback
- [x] Write-ahead audit ordering; egress fails closed with approval preserved
- [x] Stub-mode test suite (9 tests)
