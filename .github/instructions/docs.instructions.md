---
applyTo: "docs/**"
---

# Documentation Rules

## Accuracy is Non-Negotiable

- If server modules changed → verify `docs/project-structure.md` still matches
- If architecture changed → verify `docs/architecture.md` still matches
- If features shipped → mark ✅ in `docs/roadmap.md` (same commit)
- Never leave a shipped feature showing 🔄 or ❌ in the roadmap

## Roadmap Discipline

- `docs/roadmap.md` is the single source of truth for all planned work
- Phases are sequential — complete sub-phases in order
- When all sub-phases of a phase ship → update README Status table
- If everything is done → propose new phases with concrete sub-features

## Key Docs

| Doc | Purpose | Update When |
|-----|---------|-------------|
| `docs/roadmap.md` | Feature pipeline | Every feature ships |
| `docs/architecture.md` | System design | Architecture changes |
| `docs/project-structure.md` | File/module map | Modules added/removed |
| `docs/definition-of-done.md` | Quality gates | Standards evolve |
| `docs/model-tiering.md` | LLM cost strategy | Tiering logic changes |
| `docs/setup.md` | Dev environment | Dependencies change |

## Style

- Short and factual — no marketing prose
- Stats are concrete: "52 services" not "many modules"
- Mermaid diagrams for architecture (keep under 20 nodes)
- Use tables for structured data
