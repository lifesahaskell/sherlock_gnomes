import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Explorer from "@/components/explorer";
import * as api from "@/lib/api";
import * as profileAdmin from "@/lib/profile-admin";

vi.mock("@/lib/api", () => ({
  askCodebase: vi.fn(),
  getUserProfiles: vi.fn(),
  getFile: vi.fn(),
  getHealth: vi.fn(),
  getIndexStatus: vi.fn(),
  getTree: vi.fn(),
  searchCode: vi.fn(),
  searchHybrid: vi.fn(),
  startIndexing: vi.fn()
}));

vi.mock("@/lib/profile-admin", () => ({
  updateProfileAdmin: vi.fn()
}));

const mockedGetTree = vi.mocked(api.getTree);
const mockedGetFile = vi.mocked(api.getFile);
const mockedGetHealth = vi.mocked(api.getHealth);
const mockedGetIndexStatus = vi.mocked(api.getIndexStatus);
const mockedGetUserProfiles = vi.mocked(api.getUserProfiles);
const mockedSearchCode = vi.mocked(api.searchCode);
const mockedSearchHybrid = vi.mocked(api.searchHybrid);
const mockedStartIndexing = vi.mocked(api.startIndexing);
const mockedAskCodebase = vi.mocked(api.askCodebase);
const mockedUpdateProfileAdmin = vi.mocked(profileAdmin.updateProfileAdmin);

describe("Explorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetTree.mockResolvedValue({ path: "", entries: [] });
    mockedGetFile.mockResolvedValue({ path: "main.rs", content: "fn main() {}" });
    mockedGetHealth.mockResolvedValue({
      status: "ok",
      root_dir: ".",
      indexed_search_enabled: true,
      hybrid_search_enabled: true
    });
    mockedGetIndexStatus.mockResolvedValue({
      current_job: null,
      pending: false,
      last_completed_job: null
    });
    mockedGetUserProfiles.mockResolvedValue([
      {
        id: 1,
        display_name: "Ada Lovelace",
        email: "ada@example.com",
        bio: "Pioneer",
        created_at: "2026-03-06T00:00:00Z"
      },
      {
        id: 2,
        display_name: "Grace Hopper",
        email: "grace@example.com",
        bio: "Compiler",
        created_at: "2026-03-06T00:00:00Z"
      }
    ]);
    mockedUpdateProfileAdmin.mockResolvedValue({
      id: 2,
      display_name: "Grace Hopper",
      email: "grace.hopper@example.com",
      bio: "Compiler",
      created_at: "2026-03-06T00:00:00Z"
    });
    mockedSearchCode.mockResolvedValue({ query: "alpha", matches: [] });
    mockedSearchHybrid.mockResolvedValue({ query: "alpha", warnings: [], matches: [] });
    mockedStartIndexing.mockResolvedValue({
      job_id: "job-1",
      status: "queued",
      replaced_pending: false
    });
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
    mockedSearchHybrid.mockResolvedValue({
      query: "Alpha",
      warnings: [],
      matches: [
        {
          path: "src/lib.rs",
          start_line: 12,
          end_line: 18,
          snippet: "Alpha result",
          score: 0.03,
          sources: ["keyword", "semantic"]
        }
      ]
    });

    render(<Explorer />);

    await user.type(screen.getByLabelText("Search code"), "Alpha");
    await user.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => {
      expect(mockedSearchHybrid).toHaveBeenCalledWith("Alpha", "", 50);
    });
    expect(screen.getByText("src/lib.rs")).toBeInTheDocument();
    expect(screen.getByText(/L12-L18 · keyword \+ semantic/)).toBeInTheDocument();
  });

  it("can switch to keyword mode for search", async () => {
    const user = userEvent.setup();
    mockedSearchCode.mockResolvedValue({
      query: "Alpha",
      matches: [{ path: "src/lib.rs", line_number: 12, line: "Alpha result" }]
    });

    render(<Explorer />);

    await user.click(screen.getByRole("button", { name: "Keyword" }));
    await user.type(screen.getByLabelText("Search code"), "Alpha");
    await user.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => {
      expect(mockedSearchCode).toHaveBeenCalledWith("Alpha", "", 50);
    });
    expect(screen.getByText(/L12: Alpha result/)).toBeInTheDocument();
  });

  it("falls back to keyword mode when hybrid search is disabled", async () => {
    const user = userEvent.setup();
    mockedGetHealth.mockResolvedValue({
      status: "ok",
      root_dir: ".",
      indexed_search_enabled: true,
      hybrid_search_enabled: false
    });
    mockedSearchCode.mockResolvedValue({
      query: "Alpha",
      matches: [{ path: "src/lib.rs", line_number: 12, line: "Alpha result" }]
    });

    render(<Explorer />);

    await waitFor(() => {
      expect(mockedGetHealth).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("button", { name: "Hybrid" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Hybrid search is disabled by server configuration.")
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search code"), "Alpha");
    await user.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => {
      expect(mockedSearchCode).toHaveBeenCalledWith("Alpha", "", 50);
    });
    expect(mockedSearchHybrid).not.toHaveBeenCalled();
  });

  it("starts indexing from index status controls", async () => {
    const user = userEvent.setup();

    render(<Explorer />);

    await user.click(screen.getByRole("button", { name: "Start/Reindex" }));

    await waitFor(() => {
      expect(mockedStartIndexing).toHaveBeenCalledTimes(1);
    });
  });

  it("renders profile list from API response", async () => {
    render(<Explorer />);

    await waitFor(() => {
      expect(mockedGetUserProfiles).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("grace@example.com")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" }).length).toBeGreaterThanOrEqual(1);
  });

  it("edits an existing profile", async () => {
    const user = userEvent.setup();

    mockedGetUserProfiles.mockResolvedValue([
      {
        id: 2,
        display_name: "Grace Hopper",
        email: "grace@example.com",
        bio: "Compiler",
        created_at: "2026-03-06T00:00:00Z"
      }
    ]);
    mockedUpdateProfileAdmin.mockResolvedValue({
      id: 2,
      display_name: "Grace Hopper",
      email: "grace.hopper@example.com",
      bio: "Compiler",
      created_at: "2026-03-06T00:00:00Z"
    });

    render(<Explorer />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Edit" }));

    await user.clear(screen.getByLabelText("Profile email"));
    await user.type(screen.getByLabelText("Profile email"), " grace.hopper@example.com ");

    await user.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => {
      expect(mockedUpdateProfileAdmin).toHaveBeenCalledWith(2, {
        display_name: "Grace Hopper",
        email: "grace.hopper@example.com",
        bio: "Compiler"
      });
    });
  });

  it("does not render create profile controls in explorer", () => {
    render(<Explorer />);

    expect(screen.queryByRole("button", { name: "Create Profile" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile page" })).toHaveAttribute("href", "/profile");
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
