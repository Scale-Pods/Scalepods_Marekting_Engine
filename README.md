# ScalePods Growth OS

ScalePods' own AI marketing operating system — the same product ScalePods sells, run on
ScalePods. End-to-end: brand knowledge → market intelligence → strategy → content → publishing
→ analytics → self-improvement, with a human approval gate at the creative step.

**Scoped to 4 channels:** Instagram · YouTube · Facebook · LinkedIn (LinkedIn primary).

## Start here
1. Read **`docs/PRD.md`** — what we're building and why (product scope, modules, roles).
2. Read **`docs/TRD.md`** — how (stack, DB schema, n8n workflows, API scopes, brand tokens,
   and the step-by-step Claude Code **build sequence** in §13).
3. Read **`CLAUDE.md`** — the non-negotiable build rules (platform scope, video-manual-only,
   credit-safety flags, verification method).

## Provenance
Faithful re-scope of the shipped, fully-validated **Victory Growth OS**. Where a detail isn't
specified here, mirror the VE implementation. Build module-by-module and verify each
FE→n8n→Supabase→FE round-trip with a real login before moving on.

## Kickoff
Open this folder in a fresh Claude Code session and say: *"Build ScalePods Growth OS per
docs/PRD.md and docs/TRD.md, starting with the TRD §13 build sequence step 1."*
Have the credentials in TRD §10 ready.
