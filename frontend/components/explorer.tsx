"use client";

import React from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AskResponse,
  HybridSearchMatch,
  IndexStatusResponse,
  SearchMatch,
  TreeEntry,
  askCodebase,
  createUserProfile,
  getFile,
  getHealth,
  getIndexStatus,
  getTree,
  searchCode,
  searchHybrid,
  startIndexing,
  UserProfile
} from "@/lib/api";

type BusyState = {
  tree: boolean;
  file: boolean;
  search: boolean;
  ask: boolean;
  index: boolean;
  profile: boolean;
};

type SearchMode = "hybrid" | "keyword";

const INITIAL_BUSY: BusyState = {
  tree: false,
  file: false,
  search: false,
  ask: false,
  index: false,
  profile: false
};

export default function Explorer() {
  const [busy, setBusy] = useState<BusyState>(INITIAL_BUSY);
  const [error, setError] = useState<string>("");

  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<TreeEntry[]>([]);

  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");

  const [searchMode, setSearchMode] = useState<SearchMode>("hybrid");
  const [searchQuery, setSearchQuery] = useState("");
  const [keywordResults, setKeywordResults] = useState<SearchMatch[]>([]);
  const [hybridResults, setHybridResults] = useState<HybridSearchMatch[]>([]);
  const [searchWarnings, setSearchWarnings] = useState<string[]>([]);
  const [hybridSearchEnabled, setHybridSearchEnabled] = useState(true);
  const [needsIndex, setNeedsIndex] = useState(false);

  const [contextPaths, setContextPaths] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [guidance, setGuidance] = useState("");
  const [contextPreview, setContextPreview] = useState<AskResponse["context"]>([]);

  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [createdProfile, setCreatedProfile] = useState<UserProfile | null>(null);

  const [indexStatus, setIndexStatus] = useState<IndexStatusResponse | null>(null);

  const breadcrumbs = useMemo(() => {
    if (!currentPath) {
      return [];
    }
    const parts = currentPath.split("/").filter(Boolean);
    return parts.map((part, index) => ({
      label: part,
      path: parts.slice(0, index + 1).join("/")
    }));
  }, [currentPath]);

  const effectiveSearchMode: SearchMode = hybridSearchEnabled ? searchMode : "keyword";
  const searchMatchCount =
    effectiveSearchMode === "hybrid" ? hybridResults.length : keywordResults.length;
  const shouldPollIndexStatus = Boolean(
    indexStatus?.pending ||
      indexStatus?.current_job?.status === "queued" ||
      indexStatus?.current_job?.status === "running"
  );

  useEffect(() => {
    void loadTree("");
    void loadHealth();
    void refreshIndexStatus(false);
  }, []);

  useEffect(() => {
    if (!shouldPollIndexStatus) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshIndexStatus(false);
    }, 2_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [shouldPollIndexStatus]);

  async function submitProfile(event: FormEvent) {
    event.preventDefault();
    const display_name = profileName.trim();
    const email = profileEmail.trim();
    const bio = profileBio.trim();

    if (!display_name) {
      setError("Profile name is required.");
      return;
    }
    if (!email) {
      setError("Profile email is required.");
      return;
    }

    try {
      setBusy((prev) => ({ ...prev, profile: true }));
      setError("");
      const profile = await createUserProfile({
        display_name,
        email,
        bio
      });
      setCreatedProfile(profile);
      setProfileName("");
      setProfileEmail("");
      setProfileBio("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy((prev) => ({ ...prev, profile: false }));
    }
  }

  async function loadTree(path: string) {
    try {
      setBusy((prev) => ({ ...prev, tree: true }));
      setError("");
      const response = await getTree(path);
      setCurrentPath(response.path);
      setEntries(response.entries);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy((prev) => ({ ...prev, tree: false }));
    }
  }

  async function openFile(path: string) {
    try {
      setBusy((prev) => ({ ...prev, file: true }));
      setError("");
      const response = await getFile(path);
      setSelectedFile(response.path);
      setFileContent(response.content);
      setContextPaths((prev) =>
        prev.includes(response.path) ? prev : [response.path, ...prev].slice(0, 8)
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy((prev) => ({ ...prev, file: false }));
    }
  }

  async function refreshIndexStatus(showError = true) {
    try {
      const response = await getIndexStatus();
      setIndexStatus(response);
      if (showError) {
        setError("");
      }
    } catch (err) {
      if (showError) {
        setError((err as Error).message);
      }
    }
  }

  async function loadHealth() {
    try {
      const response = await getHealth();
      const enabled = response.hybrid_search_enabled !== false;
      setHybridSearchEnabled(enabled);
      if (!enabled) {
        setSearchMode("keyword");
        setHybridResults([]);
        setSearchWarnings([]);
      }
    } catch {
      setHybridSearchEnabled(true);
    }
  }

  async function triggerIndexing() {
    try {
      setBusy((prev) => ({ ...prev, index: true }));
      setError("");
      setNeedsIndex(false);
      await startIndexing();
      await refreshIndexStatus(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy((prev) => ({ ...prev, index: false }));
    }
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (!searchQuery.trim()) {
      return;
    }

    try {
      setBusy((prev) => ({ ...prev, search: true }));
      setError("");
      setNeedsIndex(false);
      setSearchWarnings([]);

      const mode: SearchMode = hybridSearchEnabled ? searchMode : "keyword";
      if (mode === "hybrid") {
        const response = await searchHybrid(searchQuery.trim(), currentPath, 50);
        setHybridResults(response.matches);
        setKeywordResults([]);
        setSearchWarnings(response.warnings);
      } else {
        const response = await searchCode(searchQuery.trim(), currentPath, 50);
        setKeywordResults(response.matches);
        setHybridResults([]);
        setSearchWarnings([]);
      }
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      setNeedsIndex(message.includes("no index exists yet"));
    } finally {
      setBusy((prev) => ({ ...prev, search: false }));
    }
  }

  function toggleContextPath(path: string) {
    setContextPaths((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [path, ...prev].slice(0, 8)
    );
  }

  async function askQuestion(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) {
      setError("Enter a question first.");
      return;
    }
    if (!contextPaths.length) {
      setError("Select at least one file for context.");
      return;
    }

    try {
      setBusy((prev) => ({ ...prev, ask: true }));
      setError("");
      const response = await askCodebase(question.trim(), contextPaths);
      setGuidance(response.guidance);
      setContextPreview(response.context);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy((prev) => ({ ...prev, ask: false }));
    }
  }

  return (
    <main className="page-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Sherlock Gnomes</p>
          <h1>AI Codebase Explorer</h1>
        </div>
        <p className="subtle">
          Browse code, search quickly, and assemble context for LLM prompts.
        </p>
      </header>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="layout-grid">
        <aside className="card tree-card">
          <div className="card-head">
            <h2>Tree</h2>
            <button
              className="ghost"
              type="button"
              onClick={() => {
                const parent = currentPath.split("/").slice(0, -1).join("/");
                void loadTree(parent);
              }}
              disabled={busy.tree || !currentPath}
            >
              Up
            </button>
          </div>
          <nav className="breadcrumbs">
            <button
              type="button"
              className={!currentPath ? "active" : ""}
              onClick={() => void loadTree("")}
            >
              root
            </button>
            {breadcrumbs.map((item) => (
              <button
                key={item.path}
                type="button"
                className={item.path === currentPath ? "active" : ""}
                onClick={() => void loadTree(item.path)}
              >
                / {item.label}
              </button>
            ))}
          </nav>
          <ul className="tree-list">
            {entries.map((entry) => (
              <li key={entry.path}>
                {entry.kind === "directory" ? (
                  <button
                    type="button"
                    className="tree-item folder"
                    onClick={() => void loadTree(entry.path)}
                  >
                    <span>▸</span> {entry.name}
                  </button>
                ) : (
                  <div className="tree-file-row">
                    <button
                      type="button"
                      className={`tree-item file ${
                        selectedFile === entry.path ? "selected" : ""
                      }`}
                      onClick={() => void openFile(entry.path)}
                    >
                      {entry.name}
                    </button>
                    <input
                      type="checkbox"
                      checked={contextPaths.includes(entry.path)}
                      onChange={() => toggleContextPath(entry.path)}
                      title="Use for question context"
                      aria-label={`Use ${entry.name} for context`}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </aside>

        <section className="card editor-card">
          <div className="card-head">
            <h2>File Viewer</h2>
            <span className="subtle">{selectedFile || "No file selected"}</span>
          </div>
          <pre className="code-view">
            {busy.file ? "Loading file..." : fileContent || "Pick a file on the left."}
          </pre>
        </section>

        <aside className="card side-card">
          <form className="profile-form" onSubmit={submitProfile}>
            <h3>Create Profile</h3>
            <label htmlFor="profile-name-input">Profile name</label>
            <input
              id="profile-name-input"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="Ada Lovelace"
            />
            <label htmlFor="profile-email-input">Profile email</label>
            <input
              id="profile-email-input"
              value={profileEmail}
              onChange={(event) => setProfileEmail(event.target.value)}
              placeholder="ada@example.com"
              type="email"
            />
            <label htmlFor="profile-bio-input">Profile bio</label>
            <textarea
              id="profile-bio-input"
              value={profileBio}
              onChange={(event) => setProfileBio(event.target.value)}
              placeholder="Short introduction"
            />
            <button type="submit" disabled={busy.profile}>
              {busy.profile ? "Creating..." : "Create Profile"}
            </button>
          </form>

          {createdProfile ? (
            <section className="profile-output">
              <h3>Latest Profile</h3>
              <p>
                <strong>{createdProfile.display_name}</strong> ({createdProfile.email})
              </p>
              {createdProfile.bio ? <p>{createdProfile.bio}</p> : null}
            </section>
          ) : null}

          <section className="index-card">
            <div className="card-head">
              <h3>Index status</h3>
              <button type="button" onClick={() => void triggerIndexing()} disabled={busy.index}>
                {busy.index ? "Starting..." : "Start/Reindex"}
              </button>
            </div>
            {indexStatus?.current_job ? (
              <p className="subtle">
                {indexStatus.current_job.status.toUpperCase()} · scanned {indexStatus.current_job.files_scanned}
                , indexed {indexStatus.current_job.files_indexed}, blocks {indexStatus.current_job.blocks_indexed}
              </p>
            ) : (
              <p className="subtle">No indexing jobs yet.</p>
            )}
            {indexStatus?.pending ? <p className="subtle">A newer indexing request is queued.</p> : null}
            {indexStatus?.last_completed_job?.status === "failed" ? (
              <p className="error-inline">
                Last job failed: {indexStatus.last_completed_job.error ?? "unknown error"}
              </p>
            ) : null}
          </section>

          <form className="search-form" onSubmit={runSearch}>
            <label htmlFor="search-input">Search code</label>
            <div className="mode-toggle" role="group" aria-label="Search mode">
              {hybridSearchEnabled ? (
                <button
                  type="button"
                  className={searchMode === "hybrid" ? "active" : ""}
                  onClick={() => setSearchMode("hybrid")}
                >
                  Hybrid
                </button>
              ) : null}
              <button
                type="button"
                className={effectiveSearchMode === "keyword" ? "active" : ""}
                onClick={() => setSearchMode("keyword")}
              >
                Keyword
              </button>
            </div>
            {!hybridSearchEnabled ? (
              <p className="subtle">Hybrid search is disabled by server configuration.</p>
            ) : null}
            <div className="row">
              <input
                id="search-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="function name, symbol, text..."
              />
              <button type="submit" disabled={busy.search}>
                {busy.search ? "..." : "Go"}
              </button>
            </div>
          </form>

          <div className="search-results">
            <h3>Matches ({searchMatchCount})</h3>
            {needsIndex ? (
              <div className="search-cta">
                <p>No index exists yet. Start indexing to enable search.</p>
                <button type="button" onClick={() => void triggerIndexing()} disabled={busy.index}>
                  Start Indexing
                </button>
              </div>
            ) : null}
            {searchWarnings.map((warning) => (
              <p key={warning} className="warning-inline">
                {warning}
              </p>
            ))}
            <ul>
              {effectiveSearchMode === "keyword"
                ? keywordResults.map((match) => (
                    <li key={`${match.path}:${match.line_number}`}>
                      <button type="button" onClick={() => void openFile(match.path)}>
                        <strong>{match.path}</strong>
                        <span>
                          L{match.line_number}: {match.line}
                        </span>
                      </button>
                    </li>
                  ))
                : hybridResults.map((match) => (
                    <li key={`${match.path}:${match.start_line}:${match.end_line}`}>
                      <button type="button" onClick={() => void openFile(match.path)}>
                        <strong>{match.path}</strong>
                        <span>
                          L{match.start_line}-L{match.end_line} · {match.sources.join(" + ")}
                        </span>
                        <span>{match.snippet}</span>
                      </button>
                    </li>
                  ))}
            </ul>
          </div>

          <form className="ask-form" onSubmit={askQuestion}>
            <label htmlFor="ask-input">Ask with selected files</label>
            <textarea
              id="ask-input"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What architecture risks exist in this code?"
            />
            <p className="subtle">Context files: {contextPaths.length}/8</p>
            <button type="submit" disabled={busy.ask}>
              {busy.ask ? "Preparing..." : "Build AI Context"}
            </button>
          </form>

          {guidance ? (
            <section className="ask-output">
              <h3>Prompt Guidance</h3>
              <p>{guidance}</p>
              <ul>
                {contextPreview.map((item) => (
                  <li key={item.path}>
                    <strong>{item.path}</strong>
                    <pre>{item.preview || "(empty preview)"}</pre>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
