# AGENTS.md — mandatory engineering contract

## Mandatory workflow and automated guard
Read `docs/ENGINEERING_PLAYBOOK.md` before every change. Run `npm run check:architecture` before opening a PR. The checker enforces selected import boundaries; it does not replace code review, strict typecheck or tests. Keep architectural exceptions in a reviewed ADR, never bypass the checker. No code changes may be described as verified unless the commands actually ran.

Read `docs/ARCHITECTURE.md`, `docs/API_CONTRACTS.md`, `docs/RBAC_MATRIX.md`, and `docs/TEST_STRATEGY.md` before editing. PRD and ADR-001 override old plans. Do not invent features or endpoints.

## Parallel work mandatory: backend + dashboard
Before writing a feature, read `docs/PARALLEL_DEVELOPMENT.md`. For the first implementation phase, execute `docs/AGENT_START_PHASE_0.md` in order and report checked commands before feature development. Work only in this repository. The backend owns API contract, auth/security, validation and data semantics. Dashboard consumes versioned contracts and may proceed with independent mocks; do not treat demo adapters as implemented production endpoints. At each endpoint handshake, check DTOs, response envelope, pagination, errors, role/tenant/branch scope and sample payloads. Never silently change a contract in one repository. Each feature must finish with explicit test/build verification and a cross-repo handoff note. If backend and dashboard disagree, mark integration BLOCKED rather than guessing.

## Non-negotiable rules
1. Feature-first modules. Each module owns UI/application/domain/infrastructure as applicable. Imports follow dependency direction; no feature imports another feature's private files. Public barrels only.
2. Strict TypeScript; no `any`, unsafe casts, untyped JSON, ignored TS errors, or silent catch. Validate external input at boundaries (Zod for clients, DTO validation for Nest).
3. Keep UI presentation separate from network/state. All HTTP via typed API adapters; mock and live satisfy same interface. Never import fixtures in screen components.
4. No duplicated UI primitives, API clients, error handling, role checks, or domain models. Reuse shared packages. Do not over-abstract one-off logic.
5. Server is sole authority for tenant/branch RBAC, subscription, QR validation, rate limits, cooldown and idempotency. Frontend route guards are UX only.
6. Small cohesive functions; descriptive names; single responsibility; explicit dependencies; immutable updates. Avoid giant components, circular dependencies, hidden global state, and magic strings.
7. Errors are typed, observable and user-safe. Handle loading, empty, offline, forbidden and expired states. Do not claim a call was delivered when merely recorded.
8. Accessibility, Arabic RTL, responsive layouts, keyboard focus, safe-area on mobile; use design tokens, no ad-hoc styling duplication.
9. Security: no secrets, passwords, token logs, unsafe localStorage credentials, bypassed permissions, raw SQL interpolation or untrusted URLs. No GPS or checkout in V1.
10. Tests required with every behavior change: unit for logic, integration for adapters, E2E for critical paths. No snapshots as substitute for behavior tests.
11. Every contract change: update backend OpenAPI, version/changelog, fixture schemas, all impacted adapters, contract tests and CI. Mock data need NOT synchronize at runtime across apps.
12. No drive-by refactors. Inspect existing code, list impacted files, implement minimal coherent change, run lint/typecheck/tests/build, report exact results and limitations.
13. Do not suppress CI, disable validation, introduce `TODO` as fake implementation, or claim unrun tests passed. Never rewrite another app's files without need.
14. One source of truth per concept. Document ADR for architectural changes; do not silently reverse approved decisions.
15. Respect deployment boundaries and workspace package exports. No cross-app relative imports; use packages.
16. When task is ambiguous, prefer existing architecture and ask only if a decision materially changes behavior.
## Completion checklist
- [ ] Correct feature module and boundary
- [ ] Types, validation, auth/tenant scoping
- [ ] Mock/live parity and API compatibility
- [ ] Error/empty/loading/accessibility/RTL
- [ ] Tests and no regressions
- [ ] Typecheck, lint, tests, build actually executed
- [ ] Docs and changelog updated
- [ ] No secrets or unrelated modifications

## REQUIRED after EVERY feature (no exceptions)
Read and follow `docs/FEATURE_COMPLETION_CHECKLIST.md`. Design for modularity, customization through typed props/config/theme/i18n, reusability without premature abstraction, and easy independent changes. Before completion, self-review all changed files for duplication, responsibility boundaries and maintainability. Run architecture check, typecheck, lint/tests/build where configured, and validate normal/error/empty states. Report PASS/FAIL/NOT RUN for each gate. If any required gate fails or was not run, mark work NOT COMPLETE and explain why; never claim success without evidence. This instruction applies to each feature, bugfix and refactor, not just project milestones.
