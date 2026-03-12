use std::collections::HashSet;

use tree_sitter::{Language, Node, Parser};

const TARGET_TOKENS: usize = 400;
const OVERLAP_TOKENS: usize = 80;

#[derive(Debug, Clone)]
pub struct ParsedBlock {
    pub start_line: i32,
    pub end_line: i32,
    pub content: String,
    pub snippet: String,
}

pub fn parse_semantic_blocks(path: &str, content: &str) -> Vec<ParsedBlock> {
    let extension = path
        .rsplit('.')
        .next()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    let mut blocks = match extension.as_str() {
        "rs" => parse_tree_sitter_blocks(content, rust_language(), &rust_node_kinds()),
        "ts" | "mts" | "cts" => {
            parse_tree_sitter_blocks(content, typescript_language(), &typescript_node_kinds())
        }
        "tsx" => parse_tree_sitter_blocks(content, tsx_language(), &typescript_node_kinds()),
        "js" | "mjs" | "cjs" | "jsx" => {
            parse_tree_sitter_blocks(content, javascript_language(), &javascript_node_kinds())
        }
        "md" | "mdx" => parse_markdown_blocks(content),
        _ => Vec::new(),
    };

    if blocks.is_empty() {
        blocks = split_text_into_windows(content, 1, TARGET_TOKENS, OVERLAP_TOKENS);
    }

    normalize_blocks(blocks)
}

fn rust_language() -> Language {
    tree_sitter_rust::LANGUAGE.into()
}

fn typescript_language() -> Language {
    tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
}

fn tsx_language() -> Language {
    tree_sitter_typescript::LANGUAGE_TSX.into()
}

fn javascript_language() -> Language {
    tree_sitter_javascript::LANGUAGE.into()
}

fn rust_node_kinds() -> HashSet<&'static str> {
    HashSet::from([
        "function_item",
        "struct_item",
        "enum_item",
        "trait_item",
        "impl_item",
        "mod_item",
        "type_item",
        "const_item",
    ])
}

fn typescript_node_kinds() -> HashSet<&'static str> {
    HashSet::from([
        "function_declaration",
        "class_declaration",
        "interface_declaration",
        "type_alias_declaration",
        "method_definition",
        "arrow_function",
    ])
}

fn javascript_node_kinds() -> HashSet<&'static str> {
    HashSet::from([
        "function_declaration",
        "class_declaration",
        "method_definition",
        "arrow_function",
    ])
}

fn parse_tree_sitter_blocks(
    source: &str,
    language: Language,
    interesting_kinds: &HashSet<&str>,
) -> Vec<ParsedBlock> {
    let mut parser = Parser::new();
    if parser.set_language(&language).is_err() {
        return Vec::new();
    }

    let Some(tree) = parser.parse(source, None) else {
        return Vec::new();
    };

    let line_index = LineIndex::new(source);
    let mut blocks = Vec::new();
    collect_interesting_nodes(
        tree.root_node(),
        source,
        &line_index,
        interesting_kinds,
        &mut blocks,
    );

    blocks
}

fn collect_interesting_nodes(
    node: Node<'_>,
    source: &str,
    line_index: &LineIndex,
    interesting_kinds: &HashSet<&str>,
    blocks: &mut Vec<ParsedBlock>,
) {
    if interesting_kinds.contains(node.kind())
        && let Ok(raw_text) = node.utf8_text(source.as_bytes())
    {
        let text = raw_text.trim();
        if !text.is_empty() {
            let start_line = line_index.line_for_byte(node.start_byte()) as i32;
            let base_end_line = line_index.line_for_byte(node.end_byte()) as i32;
            let estimated_tokens = token_count(text);
            if estimated_tokens > TARGET_TOKENS + OVERLAP_TOKENS {
                blocks.extend(split_text_into_windows(
                    text,
                    start_line,
                    TARGET_TOKENS,
                    OVERLAP_TOKENS,
                ));
            } else {
                blocks.push(ParsedBlock {
                    start_line,
                    end_line: base_end_line.max(start_line),
                    content: text.to_string(),
                    snippet: build_snippet(text),
                });
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_interesting_nodes(child, source, line_index, interesting_kinds, blocks);
    }
}

fn parse_markdown_blocks(content: &str) -> Vec<ParsedBlock> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return Vec::new();
    }

    let heading_indices: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            let trimmed = line.trim_start();
            if trimmed.starts_with('#') {
                Some(index)
            } else {
                None
            }
        })
        .collect();

    if heading_indices.is_empty() {
        return Vec::new();
    }

    let mut blocks = Vec::new();
    for (position, heading_start) in heading_indices.iter().enumerate() {
        let section_start = *heading_start;
        let section_end = heading_indices
            .get(position + 1)
            .copied()
            .unwrap_or(lines.len())
            .saturating_sub(1);

        if section_start > section_end || section_end >= lines.len() {
            continue;
        }

        let section_text = lines[section_start..=section_end].join("\n");
        if token_count(&section_text) > TARGET_TOKENS + OVERLAP_TOKENS {
            blocks.extend(split_text_into_windows(
                &section_text,
                (section_start + 1) as i32,
                TARGET_TOKENS,
                OVERLAP_TOKENS,
            ));
        } else {
            blocks.push(ParsedBlock {
                start_line: (section_start + 1) as i32,
                end_line: (section_end + 1) as i32,
                content: section_text.clone(),
                snippet: build_snippet(&section_text),
            });
        }
    }

    blocks
}

fn split_text_into_windows(
    text: &str,
    base_start_line: i32,
    target_tokens: usize,
    overlap_tokens: usize,
) -> Vec<ParsedBlock> {
    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return Vec::new();
    }

    let token_counts: Vec<usize> = lines.iter().map(|line| token_count(line)).collect();
    let mut blocks = Vec::new();

    let mut start_index = 0usize;
    while start_index < lines.len() {
        let mut end_index = start_index;
        let mut consumed_tokens = 0usize;

        while end_index < lines.len()
            && (consumed_tokens + token_counts[end_index] <= target_tokens
                || end_index == start_index)
        {
            consumed_tokens += token_counts[end_index].max(1);
            end_index += 1;
        }

        let inclusive_end = end_index.saturating_sub(1);
        if inclusive_end < start_index {
            break;
        }

        let block_text = lines[start_index..=inclusive_end]
            .join("\n")
            .trim()
            .to_string();
        if !block_text.is_empty() {
            let block_start_line = base_start_line + start_index as i32;
            let block_end_line = base_start_line + inclusive_end as i32;
            blocks.push(ParsedBlock {
                start_line: block_start_line,
                end_line: block_end_line,
                content: block_text.clone(),
                snippet: build_snippet(&block_text),
            });
        }

        if end_index >= lines.len() {
            break;
        }

        let mut overlap = 0usize;
        let mut next_start = end_index;
        while next_start > start_index {
            let prior = next_start - 1;
            overlap += token_counts[prior].max(1);
            next_start -= 1;
            if overlap >= overlap_tokens {
                break;
            }
        }

        if next_start <= start_index {
            start_index = end_index;
        } else {
            start_index = next_start;
        }
    }

    blocks
}

fn normalize_blocks(mut blocks: Vec<ParsedBlock>) -> Vec<ParsedBlock> {
    blocks.retain(|block| !block.content.trim().is_empty());
    blocks.sort_by(|left, right| {
        left.start_line
            .cmp(&right.start_line)
            .then_with(|| left.end_line.cmp(&right.end_line))
    });
    blocks.dedup_by(|left, right| {
        left.start_line == right.start_line
            && left.end_line == right.end_line
            && left.content == right.content
    });
    blocks
}

fn token_count(text: &str) -> usize {
    text.split_whitespace().count().max(1)
}

fn build_snippet(text: &str) -> String {
    let mut lines = text.lines().take(8).collect::<Vec<_>>().join("\n");
    if lines.len() > 420 {
        let mut cutoff = 420;
        while cutoff > 0 && !lines.is_char_boundary(cutoff) {
            cutoff -= 1;
        }
        lines.truncate(cutoff);
    }
    lines
}

struct LineIndex {
    starts: Vec<usize>,
}

impl LineIndex {
    fn new(source: &str) -> Self {
        let mut starts = vec![0usize];
        for (index, byte) in source.as_bytes().iter().enumerate() {
            if *byte == b'\n' {
                starts.push(index + 1);
            }
        }
        Self { starts }
    }

    fn line_for_byte(&self, byte: usize) -> usize {
        match self.starts.binary_search(&byte) {
            Ok(index) => index + 1,
            Err(index) => index.max(1),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn assert_block_starts_and_substrings(
        blocks: &[ParsedBlock],
        expected_starts: &[i32],
        expected_substrings: &[&str],
    ) {
        let starts = blocks
            .iter()
            .map(|block| block.start_line)
            .collect::<Vec<_>>();
        assert_eq!(starts, expected_starts);

        for expected in expected_substrings {
            assert!(
                blocks.iter().any(|block| block.content.contains(expected)),
                "missing block containing {expected:?}: {blocks:#?}",
            );
        }
    }

    #[test]
    fn fallback_windowing_creates_multiple_blocks_for_large_text() {
        let text = (1..=300)
            .map(|line| format!("line {line} with several words for token counting"))
            .collect::<Vec<_>>()
            .join("\n");

        let blocks = split_text_into_windows(&text, 1, 100, 20);
        assert!(blocks.len() > 1);
        assert!(blocks.first().map(|block| block.start_line) == Some(1));
    }

    #[test]
    fn markdown_parser_uses_headings_as_boundaries() {
        let text = "# Intro\na\n## Details\nb\n";
        let blocks = parse_markdown_blocks(text);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].start_line, 1);
        assert_eq!(blocks[1].start_line, 3);
    }

    #[test]
    fn rust_files_use_tree_sitter_blocks_instead_of_fallback_windowing() {
        let text = "struct Thing;\n\nfn answer() -> i32 {\n    42\n}\n\nconst VALUE: i32 = 1;\n";
        let blocks = parse_semantic_blocks("src/lib.rs", text);

        assert_block_starts_and_substrings(
            &blocks,
            &[1, 3, 7],
            &["struct Thing", "fn answer()", "const VALUE"],
        );
    }

    #[test]
    fn typescript_file_extensions_use_typescript_parser() {
        let text = "interface User {\n    name: string;\n}\n\nfunction greet(user: User): string {\n    return user.name;\n}\n\ntype Greeter = (user: User) => string;\n";

        for path in ["client.ts", "client.mts", "client.cts"] {
            let blocks = parse_semantic_blocks(path, text);
            assert_block_starts_and_substrings(
                &blocks,
                &[1, 5, 9],
                &["interface User", "function greet", "type Greeter"],
            );
        }
    }

    #[test]
    fn tsx_files_use_tsx_parser() {
        let text = "type Props = { name: string };\n\nfunction Greeting(props: Props) {\n    return <section>{props.name}</section>;\n}\n\nconst Footer = () => <footer>done</footer>;\n";
        let blocks = parse_semantic_blocks("component.tsx", text);

        assert_block_starts_and_substrings(
            &blocks,
            &[1, 3, 7],
            &["type Props", "function Greeting", "<footer>done</footer>"],
        );
    }

    #[test]
    fn javascript_file_extensions_use_javascript_parser() {
        let text =
            "function greet(name) {\n    return `hi ${name}`;\n}\nconst answer = () => 42;\n";

        for path in ["client.js", "client.mjs", "client.cjs"] {
            let blocks = parse_semantic_blocks(path, text);
            assert_block_starts_and_substrings(&blocks, &[1, 4], &["function greet", "() => 42"]);
        }
    }

    #[test]
    fn markdown_file_extensions_use_heading_boundaries() {
        let text = "# Intro\na\n## Details\nb\n";

        for path in ["docs/readme.md", "docs/readme.mdx"] {
            let blocks = parse_semantic_blocks(path, text);
            assert_block_starts_and_substrings(&blocks, &[1, 3], &["# Intro", "## Details"]);
        }
    }

    #[test]
    fn snippet_truncation_preserves_utf8_boundaries() {
        let text = format!("{}ésuffix", "a".repeat(419));
        let snippet = build_snippet(&text);
        assert_eq!(snippet.len(), 419);
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(32))]

        #[test]
        fn parse_semantic_blocks_preserves_output_invariants(
            extension in prop::sample::select(vec!["rs", "ts", "tsx", "js", "jsx", "md", "mdx", "txt"]),
            content in prop::collection::vec(any::<char>(), 0..1200).prop_map(|chars| chars.into_iter().collect::<String>()),
        ) {
            let path = format!("property_input.{extension}");
            let blocks = parse_semantic_blocks(&path, &content);

            for block in &blocks {
                prop_assert!(block.start_line >= 1);
                prop_assert!(block.end_line >= block.start_line);
                prop_assert!(!block.content.trim().is_empty());
                prop_assert!(block.snippet.len() <= 420);
            }

            for pair in blocks.windows(2) {
                let left = &pair[0];
                let right = &pair[1];
                prop_assert!(
                    left.start_line < right.start_line
                        || (left.start_line == right.start_line && left.end_line <= right.end_line)
                );
            }
        }
    }
}
