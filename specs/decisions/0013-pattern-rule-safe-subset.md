# 0013. Pattern rules use a whitelisted safe regex subset

Status: accepted
Date: 2026-10-10

## Context

Staff author `pattern` rules, and the server runs them on JavaScript's
backtracking regex engine against public input. A crafted or careless
pattern can take exponential time and stall the server. Blacklist
heuristics (rejecting nested quantifiers and the like) were tried during
review and shown to leak catastrophic cases.

## Decision

A whitelist scanner accepts only literals, escapes, character classes,
anchors, quantifiers on single atoms, and non-quantified groups with
alternation. Patterns are at most 200 characters, with at most two
quantifiers, bounded repeats up to 1,000, a group depth of two and at most
four `|`. Quantified groups, backreferences and lookarounds are rejected.
A pattern runs only against answers of up to 1,000 graphemes and UTF-16
code units, and publish validation requires a field with a pattern rule to
cap its length at 1,000 or below unless its type already does.

## Consequences

- Expressiveness is limited: some legitimate formats cannot be written,
  and staff see a rejection instead.
- The follow-up is a linear-time engine such as re2js, which removes the
  subset limits. It is a new dependency in a `domain/` layer and needs the
  user's approval under ADR 0012 before it is adopted.
