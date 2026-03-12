import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CodeView from "@/components/code-view";

describe("CodeView", () => {
  it("detects syntax from the file path and highlights Rust tokens", () => {
    render(
      <CodeView
        code={`fn main() {\n    println!("hi");\n}`}
        path="sample-repo:src/main.rs"
      />
    );

    expect(screen.getByText("Rust")).toBeInTheDocument();

    const codeViewer = screen.getByLabelText("Code viewer");
    expect(within(codeViewer).getByText("fn")).toHaveAttribute("data-token-kind", "keyword");
    expect(within(codeViewer).getByText('"hi"')).toHaveAttribute("data-token-kind", "string");
  });

  it("prefers explicit language metadata when available", () => {
    render(
      <CodeView
        code={`function meaning() {\n  return 42;\n}`}
        path="stored-file"
        language="JavaScript"
      />
    );

    expect(screen.getByText("JavaScript")).toBeInTheDocument();

    const codeViewer = screen.getByLabelText("Code viewer");
    expect(within(codeViewer).getByText("return")).toHaveAttribute(
      "data-token-kind",
      "keyword"
    );
    expect(within(codeViewer).getByText("42")).toHaveAttribute("data-token-kind", "number");
  });
});
