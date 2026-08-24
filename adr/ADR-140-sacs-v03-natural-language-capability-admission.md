# ADR-140: SACS v0.3 Natural-Language Capability Admission

## Status

Accepted on 2026-08-24 for the trusted-intranet `ugv-agent-profile` compatibility boundary.

## Context

SACS v0.3 is a client/product version, not an A2A protocol version. It discovers one fixed SDAR from
the Agent Card and submits an ordinary natural-language A2A message. The Runtime currently advertises
`text/plain` and no authentication requirement, but the UGV Profile can execute only after the caller
supplies private SDAR metadata (`io.sdar/requestedCapability`, `idempotency_key`,
`structured_input`) and a matching Data Part. It validates the Capability Binding before generic
natural-language preparation. The public contract and the actual admission contract therefore
contradict each other, and SACS cannot legally create a Task using only public discovery.

ADR-139 correctly prevents mutable prose or model output from becoming physical target authority.
However, requiring every public caller to fabricate internal admission records is not the only way
to preserve that invariant. SDAR can deterministically translate an exact, bounded natural-language
coordinate request into the same versioned Capability input and then persist it through the existing
PostgreSQL authority transaction.

## Decision

- Keep ADR-069 unchanged: the wire remains A2A 1.0 / normative specification 1.0.1. Do not enable
  the SDK's unrelated A2A v0.3 compatibility module.
- Add a protocol-neutral Application resolver for natural-language Capability admission. A protocol
  adapter may provide a stable client request identity, but it cannot name an Exposure, parse UGV
  coordinates or create a binding.
- For `ugv-agent-profile`, admit only an unambiguous point-navigation sentence containing exactly one
  explicitly labelled finite longitude and latitude. The deterministic resolver emits the existing
  `embodied.move@2` / `a2a.embodied.move@2` structured input for `vehicle:ugv1`. It does not invoke a
  model, infer a relative destination, swap axes, accept an altitude as authority, or select another
  operation.
- The resulting typed request is re-resolved against the current active managed Card Exposure,
  readiness and Provider Binding, validated against the frozen request schema, and atomically stored
  as the Task Capability Binding/Attempt and initial admission. The immutable binding—not the prose—
  remains the sole planning, MCP dispatch and terminal target authority.
- A2A `messageId` is a replay identity, not business authority. SDAR hashes it into a bounded
  server-owned idempotency key. The existing canonical semantic request hash still detects reuse with
  different text/input and excludes SDK-generated Task/Context identifiers.
- Keep the UGV enabled-Skill public Card boundary, but publish a safe optional extension whose
  admission contract is resolved from the current PostgreSQL managed Exposure/readiness authority.
  It contains Exposure/capability versions, request schema, requester policy and natural-language
  admission semantics. Continue to advertise `text/plain` because the endpoint now honors it.
- Align the trusted-intranet boundary: the UGV Exposure permits anonymous initial A2A admission when
  the Card has empty security requirements. This does not authorize execution. Existing outer plan
  confirmation, governed-control identity, current Provider authority, side-effect gate, exactly-once
  MCP Task dispatch and terminal evidence remain mandatory.
- Preserve the strict explicit structured admission for clients that choose it. Natural admission is
  attempted only for metadata-free, Data-free text requests, so it cannot silently reinterpret an
  explicit or partially formal request.

## Consequences

- SACS v0.3 can use the public A2A 1.0 natural-language contract without management access or private
  SDAR metadata.
- A precise coordinate sentence creates the same durable authority chain as the explicit structured
  path. Duplicate message delivery cannot create a second Task or navigation.
- Ambiguous, duplicate, relative or out-of-range coordinates fail before Capability persistence and
  before side effects; future interactive clarification may extend this boundary separately.
- The public Card becomes truthful and machine-discoverable for both natural-language and structured
  clients.
- This decision narrows ADR-139's rejected “trust text” alternative: raw text is still never trusted
  directly. A deterministic, versioned, schema-validated server translation may supply the candidate
  input, and PostgreSQL acceptance remains the authority transition.

## Rejected Alternatives

- Enable A2A v0.3 protocol compatibility: SACS v0.3 does not imply that wire version.
- Require SACS to call management APIs or create a Binding: this crosses the public protocol and
  authority boundary.
- Teach the A2A adapter UGV semantics: this leaks Profile/domain policy into the SDK boundary.
- Let the LLM extract or infer the target: model output is not authorization data.
- Remove the binding prerequisite: this would let planning and dispatch diverge from durable target
  authority.
- Keep anonymous denied while advertising no security requirement: this preserves the contradictory
  public contract that caused the incompatibility.

## Evidence

Implementation and test evidence is tracked by
`execplans/EP-SDAR-SACS-V03-NATURAL-LANGUAGE-ADMISSION.md` and
`docs/17_TRACEABILITY_MATRIX.md`. Acceptance evidence is 8 focused files/204 tests, one real local
Runtime/PostgreSQL/Redis integration, typecheck, production build, 852-source architecture and
changed-scope lint/format/diff gates, all passing. The integration uses a frozen local Provider and
does not claim external UGV or simulator acceptance.
