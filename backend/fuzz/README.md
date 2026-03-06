# Backend Fuzzing Runbook

## Short PR Fuzz Run

```bash
cargo +nightly fuzz run parse_semantic_blocks --sanitizer address -- -max_total_time=90 -max_len=32768
```

## Long Nightly Fuzz Run

```bash
cargo +nightly fuzz run parse_semantic_blocks --sanitizer address -- -max_total_time=900 -max_len=32768
```

## Crash Triage

1. Reproduce with the generated artifact:

```bash
cargo +nightly fuzz run parse_semantic_blocks artifacts/parse_semantic_blocks/<crash-file>
```

2. Minimize the crashing input:

```bash
cargo +nightly fuzz tmin parse_semantic_blocks artifacts/parse_semantic_blocks/<crash-file>
```

3. Add minimized inputs to `corpus/parse_semantic_blocks/` so regressions remain covered in CI.
