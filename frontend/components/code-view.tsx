"use client";

import React, { useMemo } from "react";
import { highlightCode } from "@/lib/syntax-highlight";

type CodeViewProps = {
  code: string;
  path: string;
  language?: string | null;
  emptyMessage?: string;
  ariaLabel?: string;
};

export default function CodeView({
  code,
  path,
  language,
  emptyMessage = "(empty file)",
  ariaLabel = "Code viewer"
}: CodeViewProps) {
  const highlighted = useMemo(
    () => highlightCode(code, path, language),
    [code, language, path]
  );

  return (
    <div className="code-view-shell">
      <div className="code-view-meta">
        <span className="code-language-tag">{highlighted.syntax.label}</span>
      </div>
      <pre className="code-view" aria-label={ariaLabel}>
        {code ? (
          <code>
            {highlighted.lines.map((line, lineIndex) => (
              <span key={lineIndex} className="code-line">
                {line.length === 0 ? (
                  <span className="code-token" data-token-kind="plain">
                    {"\u200b"}
                  </span>
                ) : (
                  line.map((token, tokenIndex) => (
                    <span
                      key={`${lineIndex}-${tokenIndex}`}
                      className={`code-token token-${token.kind}`}
                      data-token-kind={token.kind}
                    >
                      {token.value}
                    </span>
                  ))
                )}
              </span>
            ))}
          </code>
        ) : (
          <code className="code-view-empty">{emptyMessage}</code>
        )}
      </pre>
    </div>
  );
}
