# NullTrace

NullTrace supports an operator-led penetration testing session by turning scanner output into reviewable security signals.

## Language

**Finding**:
A security-relevant signal observed during a testing session and produced from scanner output. A finding records what the tooling observed, not the operator's judgment about it.
_Avoid_: Vulnerability, vuln, issue, alert

**Finding Review**:
The operator's judgment about a finding. A finding review records how the operator has triaged the finding without changing what the tooling observed, and exists only after the operator first interacts with the finding.
_Avoid_: Finding, scanner result

**Review Status**:
The operator-assigned state of a finding review: needs review, confirmed, or dismissed. A finding without an explicit review is treated as needs review, and a review status does not describe whether the finding still exists on the target.
_Avoid_: Finding status, resolved status

**Source Context**:
The scanner-derived details shown to help an operator understand why a finding exists. Source context is displayed from the finding's lightweight payload and may reference the original artifact, but it is not a separate record or source of truth.
_Avoid_: Evidence, proof, raw artifact
