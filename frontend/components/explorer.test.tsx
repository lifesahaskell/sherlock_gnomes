import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Explorer from "@/components/explorer";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({
  askCodebase: vi.fn(),
  getFile: vi.fn(),
  getTree: vi.fn(),
  searchCode: vi.fn()
}));

const mockedGetTree = vi.mocked(api.getTree);
const mockedGetFile = vi.mocked(api.getFile);
const mockedSearchCode = vi.mocked(api.searchCode);
const mockedAskCodebase = vi.mocked(api.askCodebase);

describe("Explorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetTree.mockResolvedValue({ path: "", entries: [] });
    mockedGetFile.mockResolvedValue({ path: "main.rs", content: "fn main() {}" });
    mockedSearchCode.mockResolvedValue({ query: "alpha", matches: [] });
    mockedAskCodebase.mockResolvedValue({ guidance: "ok", context: [] });
  });

  it("loads tree on mount", async () => {
    mockedGetTree.mockResolvedValue({
      path: "",
      entries: [{ name: "src", path: "src", kind: "directory" }]
    });

    render(<Explorer />);

    await waitFor(() => {
      expect(mockedGetTree).toHaveBeenCalledWith("");
    });
    expect(screen.getByRole("button", { name: /src/i })).toBeInTheDocument();
  });

  it("opens a file and increments selected context count", async () => {
    const user = userEvent.setup();
    mockedGetTree.mockResolvedValue({
      path: "",
      entries: [{ name: "main.rs", path: "main.rs", kind: "file" }]
    });
    mockedGetFile.mockResolvedValue({ path: "main.rs", content: "fn main() {}" });

    render(<Explorer />);

    const fileButton = await screen.findByRole("button", { name: "main.rs" });
    await user.click(fileButton);

    await waitFor(() => {
      expect(mockedGetFile).toHaveBeenCalledWith("main.rs");
    });
    expect(screen.getByText(/fn main\(\) \{\}/)).toBeInTheDocument();
    expect(screen.getByText("Context files: 1/8")).toBeInTheDocument();
  });

  it("searches and renders match results", async () => {
    const user = userEvent.setup();
    mockedSearchCode.mockResolvedValue({
      query: "Alpha",
      matches: [{ path: "src/lib.rs", line_number: 12, line: "Alpha result" }]
    });

    render(<Explorer />);

    await user.type(screen.getByLabelText("Search code"), "Alpha");
    await user.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => {
      expect(mockedSearchCode).toHaveBeenCalledWith("Alpha", "", 50);
    });
    expect(screen.getByText("src/lib.rs")).toBeInTheDocument();
    expect(screen.getByText(/L12: Alpha result/)).toBeInTheDocument();
  });

  it("validates question and context requirements before asking", async () => {
    const user = userEvent.setup();

    render(<Explorer />);

    await user.click(screen.getByRole("button", { name: "Build AI Context" }));
    expect(screen.getByText("Enter a question first.")).toBeInTheDocument();
    expect(mockedAskCodebase).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Ask with selected files"), "What changed?");
    await user.click(screen.getByRole("button", { name: "Build AI Context" }));

    expect(screen.getByText("Select at least one file for context.")).toBeInTheDocument();
    expect(mockedAskCodebase).not.toHaveBeenCalled();
  });

  it("renders ask guidance and context preview on success", async () => {
    const user = userEvent.setup();
    mockedGetTree.mockResolvedValue({
      path: "",
      entries: [{ name: "main.rs", path: "main.rs", kind: "file" }]
    });
    mockedGetFile.mockResolvedValue({ path: "main.rs", content: "fn main() {}" });
    mockedAskCodebase.mockResolvedValue({
      guidance: "Use this context to answer.",
      context: [{ path: "main.rs", preview: "fn main() {}" }]
    });

    render(<Explorer />);

    const fileButton = await screen.findByRole("button", { name: "main.rs" });
    await user.click(fileButton);
    await user.type(
      screen.getByLabelText("Ask with selected files"),
      "What does this project do?"
    );
    await user.click(screen.getByRole("button", { name: "Build AI Context" }));

    await waitFor(() => {
      expect(mockedAskCodebase).toHaveBeenCalledWith("What does this project do?", ["main.rs"]);
    });
    expect(screen.getByText("Use this context to answer.")).toBeInTheDocument();
    const askOutput = screen
      .getByText("Prompt Guidance")
      .closest("section") as HTMLElement;
    expect(within(askOutput).getByText("main.rs")).toBeInTheDocument();
    expect(within(askOutput).getByText("fn main() {}")).toBeInTheDocument();
  });
});
