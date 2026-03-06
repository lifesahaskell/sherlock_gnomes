use std::time::{Duration, Instant};

use codebase_explorer_backend::fuzz_parse_semantic_blocks;

#[test]
fn semantic_block_parser_perf_smoke_budget() {
    if std::env::var("PERF_SMOKE").ok().as_deref() != Some("1") {
        return;
    }

    let content = (0..25_000)
        .map(|index| {
            format!("fn generated_{index}() {{ let value = {index}; println!(\"{{}}\", value); }}")
        })
        .collect::<Vec<_>>()
        .join("\n");

    let started = Instant::now();
    fuzz_parse_semantic_blocks("perf_smoke.rs", &content);
    let elapsed = started.elapsed();

    assert!(
        elapsed < Duration::from_secs(15),
        "semantic parser perf budget exceeded: {:?}",
        elapsed
    );
}
