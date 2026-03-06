#![no_main]

use codebase_explorer_backend::fuzz_parse_semantic_blocks;
use libfuzzer_sys::fuzz_target;

const EXTENSIONS: [&str; 8] = ["rs", "ts", "tsx", "js", "jsx", "md", "mdx", "txt"];

fuzz_target!(|data: &[u8]| {
    if data.is_empty() {
        return;
    }

    let extension = EXTENSIONS[(data[0] as usize) % EXTENSIONS.len()];
    let path = format!("fuzz_input.{extension}");
    let content = String::from_utf8_lossy(&data[1..]);

    fuzz_parse_semantic_blocks(&path, &content);
});
