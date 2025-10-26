# Raceway 0.1.0 Release Audit

Last updated: 2025-xx-xx  
Audited by: Codex assistant

---

## Repository Health Snapshot

- **Core engine** cleanly separates capture, storage, and analysis pipelines (`core/src/engine.rs:11`, `core/src/config.rs:5`).
- **API surface** exposes trace, analysis, and distributed insights required by the Web UI (`cli/src/server.rs:231`).
- **Frontend** consumes the new endpoints, offering trace exploration, system dashboards, and distributed views (`web/src/App.tsx:1`, `web/src/api.ts:36`).
- **Tests** include unit coverage in `raceway-core`, plus integration suites for API and distributed scenarios (`raceway-test/tests/api.rs:24`, `raceway-test/tests/distributed.rs:41`).
- **CI** runs formatting, linting, and language-specific builds via GitHub Actions (`.github/workflows/ci.yml:9`).

---

## Blocking Issues (Fix Before Tagging v0.1.0)

1. **Documentation placeholders** – README still references `yourusername/raceway` for cloning and issues; update to the real GitHub org/repo before publishing (`README.md:104`, `README.md:634`).
2. **CI integration job is a stub** – the “integration” stage in GitHub Actions only echoes a TODO. Replace with actual test execution or remove the job so release automation is trustworthy (`.github/workflows/ci.yml:104`).

---

## High-Impact Polish (Recommended Pre-Release)

- **Instrumentation expectations** – SDKs still require manual state/lock tracking; document this limitation prominently and point to the roadmap in `INSTRUMENTATION-NEXT-STEPS.md:5`.
- **Global analysis UX** – the web app triggers `/api/analyze/global` but drops the result; either surface the summary or stop firing the request to avoid noisy failures (`web/src/App.tsx:66`).
- **Repo metadata consistency** – ensure workspace Cargo, npm, Go module, and SDK metadata all reference the same GitHub repository (`Cargo.toml:6`, `sdks/typescript/package.json:23`, `sdks/go/go.mod:1`).
- **Release hygiene** – remove build artifacts from version control (e.g., `sdks/python/raceway_sdk.egg-info`, `sdks/rust/target/`) and verify `.gitignore` prevents reintroducing them.

---

## Suggested Release Sequence

1. Resolve blockers, then run full test matrix (`cargo test --all`, SDK tests, demo harness).
2. Update docs (README, CHANGELOG, CONFIG guide) with repo links, feature table for memory vs. Postgres, and manual instrumentation callouts.
3. Produce release artifacts (`cargo build --release`, `npm run build`, package SDKs) and smoke-test against both storage backends.
4. Draft GitHub release with binaries, web build instructions, and SDK packages. Publish tag `v0.1.0`, then push SDKs to crates.io/npm/PyPI/Go proxy once documentation is live.

---

## Follow-Up (Post-0.1.0 Roadmap)

- Automate instrumentation per language roadmap (`INSTRUMENTATION-NEXT-STEPS.md:105`).
- Expand UI/CLI command coverage with automated tests (see `TESTS-NEEDED.md` priority items).
- Enhance CI integration stage to run end-to-end demos.
