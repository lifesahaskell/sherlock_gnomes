import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TopNav from "@/components/top-nav";
import { usePathname } from "next/navigation";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn()
}));

const mockedUsePathname = vi.mocked(usePathname);

describe("TopNav", () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue("/");
  });

  it("renders Home, Explorer, and Docs links", () => {
    render(<TopNav />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Explorer" })).toHaveAttribute(
      "href",
      "/explorer"
    );
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
  });

  it("marks active link from pathname", () => {
    mockedUsePathname.mockReturnValue("/explorer");

    render(<TopNav />);

    expect(screen.getByRole("link", { name: "Explorer" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveClass("active");
    expect(screen.getByRole("link", { name: "Docs" })).not.toHaveClass("active");
  });

  it("marks nested route as active", () => {
    mockedUsePathname.mockReturnValue("/docs/getting-started");

    render(<TopNav />);

    expect(screen.getByRole("link", { name: "Docs" })).toHaveClass("active");
  });
});
