export type TokenKind =
  | "plain"
  | "comment"
  | "keyword"
  | "type"
  | "string"
  | "number"
  | "literal"
  | "property"
  | "meta"
  | "heading";

export type HighlightToken = {
  kind: TokenKind;
  value: string;
};

export type HighlightLine = HighlightToken[];

export type SyntaxId =
  | "plain"
  | "rust"
  | "javascript"
  | "typescript"
  | "json"
  | "css"
  | "markdown"
  | "shell"
  | "yaml"
  | "toml"
  | "python"
  | "sql"
  | "go"
  | "java"
  | "c";

export type SyntaxInfo = {
  id: SyntaxId;
  label: string;
};

type BlockComment = {
  start: string;
  end: string;
};

type CodeScannerConfig = {
  keywords: Set<string>;
  types: Set<string>;
  literals: Set<string>;
  lineComments: string[];
  blockComments: BlockComment[];
  stringDelimiters: string[];
  multilineStringDelimiters?: string[];
};

type ScannerState = {
  blockCommentEnd?: string;
  stringDelimiter?: string;
};

const SYNTAX_INFO: Record<SyntaxId, SyntaxInfo> = {
  plain: { id: "plain", label: "Plain text" },
  rust: { id: "rust", label: "Rust" },
  javascript: { id: "javascript", label: "JavaScript" },
  typescript: { id: "typescript", label: "TypeScript" },
  json: { id: "json", label: "JSON" },
  css: { id: "css", label: "CSS" },
  markdown: { id: "markdown", label: "Markdown" },
  shell: { id: "shell", label: "Shell" },
  yaml: { id: "yaml", label: "YAML" },
  toml: { id: "toml", label: "TOML" },
  python: { id: "python", label: "Python" },
  sql: { id: "sql", label: "SQL" },
  go: { id: "go", label: "Go" },
  java: { id: "java", label: "Java" },
  c: { id: "c", label: "C / C++" }
};

const LANGUAGE_ALIASES: Record<string, SyntaxId> = {
  "c": "c",
  "c++": "c",
  "cpp": "c",
  "css": "css",
  "go": "go",
  "golang": "go",
  "java": "java",
  "javascript": "javascript",
  "js": "javascript",
  "json": "json",
  "markdown": "markdown",
  "md": "markdown",
  "plain text": "plain",
  "plaintext": "plain",
  "py": "python",
  "python": "python",
  "rs": "rust",
  "rust": "rust",
  "shell": "shell",
  "sh": "shell",
  "sql": "sql",
  "toml": "toml",
  "ts": "typescript",
  "tsx": "typescript",
  "typescript": "typescript",
  "yaml": "yaml",
  "yml": "yaml"
};

const EXTENSION_ALIASES: Record<string, SyntaxId> = {
  ".c": "c",
  ".cc": "c",
  ".cpp": "c",
  ".css": "css",
  ".cxx": "c",
  ".go": "go",
  ".h": "c",
  ".hpp": "c",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsonc": "json",
  ".jsx": "javascript",
  ".md": "markdown",
  ".mdx": "markdown",
  ".mjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".sh": "shell",
  ".sql": "sql",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".toml": "toml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zsh": "shell"
};

const BASENAME_ALIASES: Record<string, SyntaxId> = {
  ".env": "shell",
  "cargo.lock": "toml",
  "cargo.toml": "toml",
  "dockerfile": "shell",
  "makefile": "shell",
  "package-lock.json": "json",
  "package.json": "json"
};

const BASE_BLOCK_COMMENTS = [{ start: "/*", end: "*/" }];

const JAVASCRIPT_KEYWORDS = [
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "of",
  "return",
  "switch",
  "throw",
  "try",
  "typeof",
  "var",
  "while",
  "yield"
];

const TYPESCRIPT_KEYWORDS = [
  ...JAVASCRIPT_KEYWORDS,
  "abstract",
  "as",
  "declare",
  "enum",
  "implements",
  "interface",
  "keyof",
  "namespace",
  "override",
  "private",
  "protected",
  "public",
  "readonly",
  "satisfies",
  "type"
];

const SHARED_TYPES = [
  "Array",
  "Boolean",
  "Date",
  "Error",
  "Map",
  "Object",
  "Promise",
  "Record",
  "Set",
  "String",
  "number",
  "string",
  "boolean",
  "unknown",
  "void"
];

const CODE_SCANNERS: Record<Exclude<SyntaxId, "plain" | "markdown">, CodeScannerConfig> = {
  rust: {
    keywords: asSet([
      "as",
      "async",
      "await",
      "break",
      "const",
      "continue",
      "crate",
      "dyn",
      "else",
      "enum",
      "extern",
      "fn",
      "for",
      "if",
      "impl",
      "in",
      "let",
      "loop",
      "match",
      "mod",
      "move",
      "mut",
      "pub",
      "ref",
      "return",
      "self",
      "Self",
      "static",
      "struct",
      "super",
      "trait",
      "type",
      "unsafe",
      "use",
      "where",
      "while"
    ]),
    types: asSet([
      "String",
      "Vec",
      "bool",
      "char",
      "f32",
      "f64",
      "i16",
      "i32",
      "i64",
      "i8",
      "isize",
      "str",
      "u16",
      "u32",
      "u64",
      "u8",
      "usize"
    ]),
    literals: asSet(["None", "Ok", "Err", "Some", "false", "true"]),
    lineComments: ["//"],
    blockComments: BASE_BLOCK_COMMENTS,
    stringDelimiters: ['"', "'"]
  },
  javascript: {
    keywords: asSet(JAVASCRIPT_KEYWORDS),
    types: asSet(SHARED_TYPES),
    literals: asSet(["false", "null", "true", "undefined"]),
    lineComments: ["//"],
    blockComments: BASE_BLOCK_COMMENTS,
    stringDelimiters: ['"', "'", "`"]
  },
  typescript: {
    keywords: asSet(TYPESCRIPT_KEYWORDS),
    types: asSet([...SHARED_TYPES, "never", "readonly"]),
    literals: asSet(["false", "null", "true", "undefined"]),
    lineComments: ["//"],
    blockComments: BASE_BLOCK_COMMENTS,
    stringDelimiters: ['"', "'", "`"]
  },
  json: {
    keywords: asSet([]),
    types: asSet([]),
    literals: asSet(["false", "null", "true"]),
    lineComments: ["//"],
    blockComments: BASE_BLOCK_COMMENTS,
    stringDelimiters: ['"']
  },
  css: {
    keywords: asSet(["from", "to"]),
    types: asSet([]),
    literals: asSet([]),
    lineComments: [],
    blockComments: BASE_BLOCK_COMMENTS,
    stringDelimiters: ['"', "'"]
  },
  shell: {
    keywords: asSet([
      "case",
      "do",
      "done",
      "elif",
      "else",
      "esac",
      "export",
      "fi",
      "for",
      "function",
      "if",
      "in",
      "local",
      "then",
      "while"
    ]),
    types: asSet([]),
    literals: asSet(["false", "true"]),
    lineComments: ["#"],
    blockComments: [],
    stringDelimiters: ['"', "'", "`"]
  },
  yaml: {
    keywords: asSet([]),
    types: asSet([]),
    literals: asSet(["false", "null", "off", "on", "true", "yes", "no"]),
    lineComments: ["#"],
    blockComments: [],
    stringDelimiters: ['"', "'"]
  },
  toml: {
    keywords: asSet([]),
    types: asSet([]),
    literals: asSet(["false", "true"]),
    lineComments: ["#"],
    blockComments: [],
    stringDelimiters: ['"', "'"],
    multilineStringDelimiters: ['"""', "'''"]
  },
  python: {
    keywords: asSet([
      "and",
      "as",
      "assert",
      "async",
      "await",
      "break",
      "class",
      "continue",
      "def",
      "del",
      "elif",
      "else",
      "except",
      "finally",
      "for",
      "from",
      "if",
      "import",
      "in",
      "is",
      "lambda",
      "not",
      "or",
      "pass",
      "raise",
      "return",
      "try",
      "while",
      "with",
      "yield"
    ]),
    types: asSet(["bool", "dict", "float", "int", "list", "set", "str", "tuple"]),
    literals: asSet(["False", "None", "True"]),
    lineComments: ["#"],
    blockComments: [],
    stringDelimiters: ['"', "'"],
    multilineStringDelimiters: ['"""', "'''"]
  },
  sql: {
    keywords: asSet([
      "alter",
      "and",
      "as",
      "by",
      "create",
      "delete",
      "drop",
      "from",
      "group",
      "having",
      "insert",
      "into",
      "join",
      "limit",
      "order",
      "select",
      "set",
      "table",
      "update",
      "values",
      "where"
    ]),
    types: asSet([
      "bigint",
      "boolean",
      "date",
      "integer",
      "jsonb",
      "numeric",
      "serial",
      "text",
      "timestamp",
      "uuid"
    ]),
    literals: asSet(["false", "null", "true"]),
    lineComments: ["--"],
    blockComments: BASE_BLOCK_COMMENTS,
    stringDelimiters: ['"', "'"]
  },
  go: {
    keywords: asSet([
      "break",
      "case",
      "chan",
      "const",
      "continue",
      "default",
      "defer",
      "else",
      "fallthrough",
      "for",
      "func",
      "go",
      "if",
      "import",
      "interface",
      "map",
      "package",
      "range",
      "return",
      "select",
      "struct",
      "switch",
      "type",
      "var"
    ]),
    types: asSet(["bool", "byte", "error", "float64", "int", "rune", "string"]),
    literals: asSet(["false", "iota", "nil", "true"]),
    lineComments: ["//"],
    blockComments: BASE_BLOCK_COMMENTS,
    stringDelimiters: ['"', "'", "`"]
  },
  java: {
    keywords: asSet([
      "abstract",
      "break",
      "case",
      "catch",
      "class",
      "continue",
      "else",
      "enum",
      "extends",
      "final",
      "finally",
      "for",
      "if",
      "implements",
      "import",
      "interface",
      "new",
      "package",
      "private",
      "protected",
      "public",
      "return",
      "static",
      "switch",
      "throw",
      "try",
      "while"
    ]),
    types: asSet(["boolean", "double", "float", "int", "long", "String", "void"]),
    literals: asSet(["false", "null", "true"]),
    lineComments: ["//"],
    blockComments: BASE_BLOCK_COMMENTS,
    stringDelimiters: ['"', "'"]
  },
  c: {
    keywords: asSet([
      "break",
      "case",
      "const",
      "continue",
      "default",
      "do",
      "else",
      "enum",
      "for",
      "if",
      "inline",
      "return",
      "sizeof",
      "static",
      "struct",
      "switch",
      "typedef",
      "union",
      "void",
      "while"
    ]),
    types: asSet(["bool", "char", "double", "float", "int", "long", "short", "size_t"]),
    literals: asSet(["false", "NULL", "true"]),
    lineComments: ["//"],
    blockComments: BASE_BLOCK_COMMENTS,
    stringDelimiters: ['"', "'"]
  }
};

const NUMBER_PATTERN =
  /^-?(?:0[xX][0-9a-fA-F]+|\d+(?:_\d+)*(?:\.\d+(?:_\d+)*)?(?:[eE][+-]?\d+)?)\b/;

export function resolveSyntax(path: string, explicitLanguage?: string | null): SyntaxInfo {
  const languageCandidate = explicitLanguage?.trim().toLowerCase();
  if (languageCandidate && LANGUAGE_ALIASES[languageCandidate]) {
    return SYNTAX_INFO[LANGUAGE_ALIASES[languageCandidate]];
  }

  const normalizedPath = normalizePath(path);
  const basename = normalizedPath.split("/").pop()?.toLowerCase() ?? "";
  if (BASENAME_ALIASES[basename]) {
    return SYNTAX_INFO[BASENAME_ALIASES[basename]];
  }

  const extensions = collectExtensions(basename);
  for (const extension of extensions) {
    if (EXTENSION_ALIASES[extension]) {
      return SYNTAX_INFO[EXTENSION_ALIASES[extension]];
    }
  }

  return SYNTAX_INFO.plain;
}

export function highlightCode(
  code: string,
  path: string,
  explicitLanguage?: string | null
): { syntax: SyntaxInfo; lines: HighlightLine[] } {
  const syntax = resolveSyntax(path, explicitLanguage);
  return {
    syntax,
    lines: highlightBySyntax(code, syntax.id)
  };
}

function highlightBySyntax(code: string, syntaxId: SyntaxId): HighlightLine[] {
  if (syntaxId === "plain") {
    return code.split("\n").map((line) => (line ? [{ kind: "plain", value: line }] : []));
  }

  if (syntaxId === "markdown") {
    return highlightMarkdown(code);
  }

  const scanner = CODE_SCANNERS[syntaxId];
  let state: ScannerState = {};

  return code.split("\n").map((line) => {
    const stateBefore = state;
    const result = tokenizeCodeLine(line, state, scanner);
    state = result.state;

    if (stateBefore.blockCommentEnd || stateBefore.stringDelimiter) {
      return result.tokens;
    }

    switch (syntaxId) {
      case "json":
        return markJsonProperties(result.tokens);
      case "yaml":
        return markKeyValueProperties(result.tokens, ":");
      case "toml":
        return markTomlLine(result.tokens);
      case "css":
        return markCssProperties(result.tokens);
      default:
        return result.tokens;
    }
  });
}

function highlightMarkdown(code: string): HighlightLine[] {
  return code.split("\n").map((line) => {
    if (!line) {
      return [];
    }

    const headingMatch = line.match(/^(\s*)(#{1,6})(\s+)(.*)$/);
    if (headingMatch) {
      return compactTokens([
        { kind: "plain", value: headingMatch[1] },
        { kind: "meta", value: headingMatch[2] },
        { kind: "plain", value: headingMatch[3] },
        { kind: "heading", value: headingMatch[4] }
      ]);
    }

    const fenceMatch = line.match(/^(\s*)(```.*)$/);
    if (fenceMatch) {
      return compactTokens([
        { kind: "plain", value: fenceMatch[1] },
        { kind: "meta", value: fenceMatch[2] }
      ]);
    }

    const quoteMatch = line.match(/^(\s*)(>+\s?)(.*)$/);
    if (quoteMatch) {
      return compactTokens([
        { kind: "plain", value: quoteMatch[1] },
        { kind: "meta", value: quoteMatch[2] },
        { kind: "plain", value: quoteMatch[3] }
      ]);
    }

    return highlightMarkdownInline(line);
  });
}

function highlightMarkdownInline(line: string): HighlightLine {
  const tokens: HighlightLine = [];
  let index = 0;

  while (index < line.length) {
    const fenceStart = line.indexOf("`", index);
    if (fenceStart === -1) {
      pushToken(tokens, "plain", line.slice(index));
      break;
    }

    pushToken(tokens, "plain", line.slice(index, fenceStart));
    const fenceEnd = line.indexOf("`", fenceStart + 1);
    if (fenceEnd === -1) {
      pushToken(tokens, "meta", line.slice(fenceStart));
      break;
    }

    pushToken(tokens, "meta", line.slice(fenceStart, fenceStart + 1));
    pushToken(tokens, "string", line.slice(fenceStart + 1, fenceEnd));
    pushToken(tokens, "meta", line.slice(fenceEnd, fenceEnd + 1));
    index = fenceEnd + 1;
  }

  return tokens;
}

function tokenizeCodeLine(
  line: string,
  state: ScannerState,
  config: CodeScannerConfig
): { tokens: HighlightLine; state: ScannerState } {
  const tokens: HighlightLine = [];
  let index = 0;
  const nextState = { ...state };

  while (index < line.length) {
    if (nextState.blockCommentEnd) {
      const blockComment = consumeUntil(line, index, nextState.blockCommentEnd);
      pushToken(tokens, "comment", blockComment.value);
      index = blockComment.nextIndex;
      nextState.blockCommentEnd = blockComment.closed ? undefined : nextState.blockCommentEnd;
      continue;
    }

    if (nextState.stringDelimiter) {
      const stringToken = consumeString(line, index, nextState.stringDelimiter);
      pushToken(tokens, "string", stringToken.value);
      index = stringToken.nextIndex;
      nextState.stringDelimiter = stringToken.closed ? undefined : nextState.stringDelimiter;
      continue;
    }

    const lineComment = config.lineComments.find((comment) => line.startsWith(comment, index));
    if (lineComment) {
      pushToken(tokens, "comment", line.slice(index));
      index = line.length;
      continue;
    }

    const blockComment = config.blockComments.find((comment) =>
      line.startsWith(comment.start, index)
    );
    if (blockComment) {
      const commentToken = consumeBlockComment(line, index, blockComment);
      pushToken(tokens, "comment", commentToken.value);
      index = commentToken.nextIndex;
      if (!commentToken.closed) {
        nextState.blockCommentEnd = blockComment.end;
      }
      continue;
    }

    const multilineDelimiter = config.multilineStringDelimiters?.find((delimiter) =>
      line.startsWith(delimiter, index)
    );
    if (multilineDelimiter) {
      const stringToken = consumeString(line, index, multilineDelimiter);
      pushToken(tokens, "string", stringToken.value);
      index = stringToken.nextIndex;
      if (!stringToken.closed) {
        nextState.stringDelimiter = multilineDelimiter;
      }
      continue;
    }

    const stringDelimiter = config.stringDelimiters.find((delimiter) =>
      line.startsWith(delimiter, index)
    );
    if (stringDelimiter) {
      const stringToken = consumeString(line, index, stringDelimiter);
      pushToken(tokens, "string", stringToken.value);
      index = stringToken.nextIndex;
      if (!stringToken.closed) {
        nextState.stringDelimiter = stringDelimiter;
      }
      continue;
    }

    const numberMatch = line.slice(index).match(NUMBER_PATTERN);
    if (numberMatch) {
      pushToken(tokens, "number", numberMatch[0]);
      index += numberMatch[0].length;
      continue;
    }

    if (isIdentifierStart(line[index])) {
      const identifier = readIdentifier(line, index);
      pushToken(tokens, classifyIdentifier(identifier, config), identifier);
      index += identifier.length;
      continue;
    }

    pushToken(tokens, "plain", line[index]);
    index += 1;
  }

  return {
    tokens,
    state: nextState
  };
}

function consumeBlockComment(
  line: string,
  start: number,
  comment: BlockComment
): { value: string; nextIndex: number; closed: boolean } {
  const endIndex = line.indexOf(comment.end, start + comment.start.length);
  if (endIndex === -1) {
    return {
      value: line.slice(start),
      nextIndex: line.length,
      closed: false
    };
  }

  return {
    value: line.slice(start, endIndex + comment.end.length),
    nextIndex: endIndex + comment.end.length,
    closed: true
  };
}

function consumeUntil(
  line: string,
  start: number,
  delimiter: string
): { value: string; nextIndex: number; closed: boolean } {
  const endIndex = line.indexOf(delimiter, start);
  if (endIndex === -1) {
    return {
      value: line.slice(start),
      nextIndex: line.length,
      closed: false
    };
  }

  return {
    value: line.slice(start, endIndex + delimiter.length),
    nextIndex: endIndex + delimiter.length,
    closed: true
  };
}

function consumeString(
  line: string,
  start: number,
  delimiter: string
): { value: string; nextIndex: number; closed: boolean } {
  let index = start + delimiter.length;
  let escaped = false;

  while (index < line.length) {
    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }

    if (line[index] === "\\") {
      escaped = true;
      index += 1;
      continue;
    }

    if (delimiter.length === 1) {
      if (line[index] === delimiter) {
        return {
          value: line.slice(start, index + 1),
          nextIndex: index + 1,
          closed: true
        };
      }
      index += 1;
      continue;
    }

    if (line.startsWith(delimiter, index)) {
      return {
        value: line.slice(start, index + delimiter.length),
        nextIndex: index + delimiter.length,
        closed: true
      };
    }

    index += 1;
  }

  return {
    value: line.slice(start),
    nextIndex: line.length,
    closed: false
  };
}

function classifyIdentifier(identifier: string, config: CodeScannerConfig): TokenKind {
  if (config.keywords.has(identifier) || config.keywords.has(identifier.toLowerCase())) {
    return "keyword";
  }
  if (config.literals.has(identifier) || config.literals.has(identifier.toLowerCase())) {
    return "literal";
  }
  if (config.types.has(identifier)) {
    return "type";
  }
  return "plain";
}

function markJsonProperties(tokens: HighlightLine): HighlightLine {
  return tokens.map((token, index) => {
    if (
      token.kind === "string" &&
      firstMeaningfulCharacter(tokens, index + 1) === ":"
    ) {
      return { ...token, kind: "property" };
    }
    return token;
  });
}

function markKeyValueProperties(tokens: HighlightLine, separator: ":" | "="): HighlightLine {
  const firstTokenIndex = firstMeaningfulTokenIndex(tokens);
  if (firstTokenIndex === -1) {
    return tokens;
  }

  const firstToken = tokens[firstTokenIndex];
  const separatorCharacter = firstMeaningfulCharacter(tokens, firstTokenIndex + 1);
  if (
    separatorCharacter === separator &&
    (firstToken.kind === "plain" || firstToken.kind === "literal")
  ) {
    const updated = [...tokens];
    updated[firstTokenIndex] = { ...firstToken, kind: "property" };
    return updated;
  }

  return tokens;
}

function markTomlLine(tokens: HighlightLine): HighlightLine {
  const firstTokenIndex = firstMeaningfulTokenIndex(tokens);
  if (firstTokenIndex === -1) {
    return tokens;
  }

  const firstToken = tokens[firstTokenIndex];
  if (
    firstToken.kind === "plain" &&
    firstToken.value.trim().startsWith("[") &&
    firstToken.value.trim().endsWith("]")
  ) {
    const updated = [...tokens];
    updated[firstTokenIndex] = { ...firstToken, kind: "meta" };
    return updated;
  }

  return markKeyValueProperties(tokens, "=");
}

function markCssProperties(tokens: HighlightLine): HighlightLine {
  const firstTokenIndex = firstMeaningfulTokenIndex(tokens);
  if (firstTokenIndex === -1) {
    return tokens;
  }

  const firstToken = tokens[firstTokenIndex];
  const trimmed = firstToken.value.trim();
  if (trimmed.startsWith("@")) {
    const updated = [...tokens];
    updated[firstTokenIndex] = { ...firstToken, kind: "meta" };
    return updated;
  }

  const separatorCharacter = firstMeaningfulCharacter(tokens, firstTokenIndex + 1);
  if (
    separatorCharacter === ":" &&
    firstToken.kind === "plain" &&
    (trimmed.startsWith("--") || /^[a-z-]+$/i.test(trimmed))
  ) {
    const updated = [...tokens];
    updated[firstTokenIndex] = { ...firstToken, kind: "property" };
    return updated;
  }

  return tokens;
}

function firstMeaningfulTokenIndex(tokens: HighlightLine): number {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value.trim()) {
      return index;
    }
  }

  return -1;
}

function firstMeaningfulCharacter(tokens: HighlightLine, startIndex: number): string | null {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const value = tokens[index].value.trimStart();
    if (value) {
      return value[0];
    }
  }

  return null;
}

function normalizePath(path: string): string {
  const repositoryPath = path.includes(":") ? path.split(":").at(-1) ?? path : path;
  return repositoryPath.split("?")[0];
}

function collectExtensions(basename: string): string[] {
  const parts = basename.split(".");
  if (parts.length < 2) {
    return [];
  }

  const extensions: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    extensions.push(`.${parts.slice(index).join(".")}`);
  }
  return extensions;
}

function isIdentifierStart(character: string | undefined): character is string {
  return Boolean(character?.match(/[A-Za-z_]/));
}

function readIdentifier(line: string, start: number): string {
  let index = start + 1;
  while (index < line.length && /[A-Za-z0-9_$]/.test(line[index])) {
    index += 1;
  }
  return line.slice(start, index);
}

function pushToken(tokens: HighlightLine, kind: TokenKind, value: string) {
  if (!value) {
    return;
  }

  const previous = tokens.at(-1);
  if (previous?.kind === kind) {
    previous.value += value;
    return;
  }

  tokens.push({ kind, value });
}

function compactTokens(tokens: HighlightLine): HighlightLine {
  return tokens.reduce<HighlightLine>((result, token) => {
    pushToken(result, token.kind, token.value);
    return result;
  }, []);
}

function asSet(values: string[]): Set<string> {
  return new Set(values);
}
