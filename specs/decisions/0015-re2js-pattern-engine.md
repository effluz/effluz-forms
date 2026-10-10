# 0015. Pattern rules run on the re2js linear-time engine

Status: accepted
Date: 2026-10-10

## Context

ADR 0013 limited `pattern` rules to a whitelisted subset because
JavaScript's backtracking engine can be stalled by a crafted pattern. It
named a linear-time engine as the follow-up and called the subset interim.
The user has approved adopting re2js, a pure JavaScript port of RE2 with
no I/O and no native code, as a second allowed `domain/` dependency.

## Decision

- `pattern` rules are compiled and matched with re2js, which runs in time
  linear in pattern and input size.
- Syntax is RE2's. Backreferences and lookarounds do not compile and are
  rejected when the rule is saved, as are repeat counts above 1,000.
- A pattern is at most 200 characters and compiles to at most 1,100
  instructions (`MAX_PROGRAM_SIZE`), because RE2 matching costs input length
  times program size and counted repeats expand in the program.
- The whole trimmed answer must match (RE2JS `testExact`), not a part of it.
- Flags stay limited to `i`, mapped to `RE2JS.CASE_INSENSITIVE`.
- The subset scanner, its quantifier, depth and alternation limits, the
  1,000-character input bound and the publish precondition on `max_length`
  are removed. The type caps already bound the input.

## Consequences

- Expressiveness is restored except for backreferences and lookarounds.
  Nested quantifiers and long alternations are accepted.
- Patterns with many wide counted repeats, such as `.{0,1000}` several times
  over, are rejected when the rule is saved. `a{1000}` still fits.
- ADR 0013 is superseded.
- ADR 0012's list of third-party dependencies allowed in `domain/` is now
  zod and re2js.
- RE2 syntax differs slightly from JavaScript's, so staff-visible guidance
  must describe RE2 rather than JavaScript patterns.
