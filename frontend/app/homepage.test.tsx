import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";

describe("HomePage", () => {
  it("renders hero content and page calls to action", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: "AI Codebase Explorer"
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Explorer" })).toHaveAttribute(
      "href",
      "/explorer"
    );
    expect(screen.getByRole("link", { name: "Read Docs" })).toHaveAttribute("href", "/docs");
  });
});
