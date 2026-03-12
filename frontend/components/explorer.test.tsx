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
  getGitRepositories: vi.fn(),
  getGitRepositoryFile: vi.fn(),
  getGitRepositoryTree: vi.fn(),
  getHealth: vi.fn(),
  getIndexStatus: vi.fn(),
  getTree: vi.fn(),
  importGitRepository: vi.fn(),
  searchCode: vi.fn(),
  searchHybrid: vi.fn(),
  startIndexing: vi.fn()
}));

vi.mock("@/lib/profile-admin", () => ({
  updateProfileAdmin: vi.fn()
}));

const mockedGetTree = vi.mocked(api.getTree);
const mockedGetFile = vi.mocked(api.getFile);
const mockedGetGitRepositories = vi.mocked(api.getGitRepositories);
const mockedGetGitRepositoryFile = vi.mocked(api.getGitRepositoryFile);
const mockedGetGitRepositoryTree = vi.mocked(api.getGitRepositoryTree);
const mockedGetHealth = vi.mocked(api.getHealth);
const mockedGetIndexStatus = vi.mocked(api.getIndexStatus);
const mockedGetUserProfiles = vi.mocked(api.getUserProfiles);
const mockedImportGitRepository = vi.mocked(api.importGitRepository);
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
    mockedGetGitRepositories.mockResolvedValue([]);
    mockedGetGitRepositoryFile.mockResolvedValue({
      path: "src/lib.rs",
      content: "pub fn answer() -> u32 {\n    42\n}",
      language: "Rust",
      line_count: 2
    });
    mockedGetGitRepositoryTree.mockResolvedValue({ path: "", entries: [] });
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
    mockedImportGitRepository.mockResolvedValue({
      id: "repo-1",
      path: "sample-repo",
      source_kind: "local",
      name: "sample-repo",
      head_commit: "abc12345",
      branch: "main",
      is_dirty: false,
      tracked_file_count: 3,
      stored_file_count: 2,
      skipped_binary_files: 1,
      skipped_large_files: 0,
      total_bytes: 42,
      analysis_summary: "Stored 2 text files from commit abc12345 on branch main.",
      imported_at: "2026-03-12T00:00:00Z",
      languages: [
        { language: "Markdown", file_count: 1, total_bytes: 12 },
        { language: "Rust", file_count: 1, total_bytes: 30 }
      ]
    });
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
    expect(screen.getByText("Rust")).toBeInTheDocument();
    expect(screen.getByLabelText("Code viewer")).toHaveTextContent("fn main() {}");
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

  it("imports a remote git repository and loads its stored tree", async () => {
    const user = userEvent.setup();
    mockedGetGitRepositoryTree.mockResolvedValue({
      path: "",
      entries: [
        { name: "src", path: "src", kind: "directory" },
        { name: "README.md", path: "README.md", kind: "file" }
      ]
    });
    mockedImportGitRepository.mockResolvedValueOnce({
      id: "repo-2",
      path: "https://github.com/example/sample-repo.git",
      source_kind: "remote",
      name: "sample-repo",
      head_commit: "def67890",
      branch: "main",
      is_dirty: false,
      tracked_file_count: 3,
      stored_file_count: 2,
      skipped_binary_files: 1,
      skipped_large_files: 0,
      total_bytes: 42,
      analysis_summary: "Stored 2 text files from commit def67890 on branch main.",
      imported_at: "2026-03-12T00:00:00Z",
      languages: [
        { language: "Markdown", file_count: 1, total_bytes: 12 },
        { language: "Rust", file_count: 1, total_bytes: 30 }
      ]
    });

    render(<Explorer />);

    await user.clear(screen.getByLabelText("Git repository source"));
    await user.type(
      screen.getByLabelText("Git repository source"),
      "https://github.com/example/sample-repo.git"
    );
    await user.click(screen.getByRole("button", { name: "Import Repository" }));

    await waitFor(() => {
      expect(mockedImportGitRepository).toHaveBeenCalledWith(
        "https://github.com/example/sample-repo.git"
      );
    });
    await waitFor(() => {
      expect(mockedGetGitRepositoryTree).toHaveBeenCalledWith("repo-2", "");
    });
    expect(screen.getByText("Remote repository")).toBeInTheDocument();
    expect(
      screen.getByText("Stored 2 text files from commit def67890 on branch main.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "README.md" })).toBeInTheDocument();
  });

  it("opens a stored repository file from the repository archive", async () => {
    const user = userEvent.setup();
    mockedGetGitRepositories.mockResolvedValue([
      {
        id: "repo-1",
        path: "sample-repo",
        source_kind: "local",
        name: "sample-repo",
        head_commit: "abc12345",
        branch: "main",
        is_dirty: true,
        tracked_file_count: 3,
        stored_file_count: 2,
        skipped_binary_files: 1,
        skipped_large_files: 0,
        total_bytes: 42,
        analysis_summary: "Stored 2 text files from commit abc12345 on branch main.",
        imported_at: "2026-03-12T00:00:00Z",
        languages: [{ language: "Rust", file_count: 1, total_bytes: 30 }]
      }
    ]);
    mockedGetGitRepositoryTree.mockResolvedValue({
      path: "",
      entries: [{ name: "src", path: "src", kind: "directory" }]
    });
    mockedGetGitRepositoryFile.mockResolvedValue({
      path: "src/lib.rs",
      content: "pub fn answer() -> u32 {\n    42\n}",
      language: "Rust",
      line_count: 2
    });

    render(<Explorer />);

    await waitFor(() => {
      expect(mockedGetGitRepositoryTree).toHaveBeenCalledWith("repo-1", "");
    });

    mockedGetGitRepositoryTree.mockResolvedValueOnce({
      path: "src",
      entries: [{ name: "lib.rs", path: "src/lib.rs", kind: "file" }]
    });

    await user.click(await screen.findByRole("button", { name: /src/i }));
    await waitFor(() => {
      expect(mockedGetGitRepositoryTree).toHaveBeenCalledWith("repo-1", "src");
    });

    await user.click(await screen.findByRole("button", { name: "lib.rs" }));
    await waitFor(() => {
      expect(mockedGetGitRepositoryFile).toHaveBeenCalledWith("repo-1", "src/lib.rs");
    });
    expect(screen.getByText("Rust")).toBeInTheDocument();
    expect(screen.getByLabelText("Code viewer")).toHaveTextContent("pub fn answer");
    expect(screen.getByText("sample-repo:src/lib.rs")).toBeInTheDocument();
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
