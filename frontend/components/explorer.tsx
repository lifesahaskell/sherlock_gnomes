"use client";

import React from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  askCodebase,
  getFile,
  getTree,
  searchCode,
  SearchMatch,
  TreeEntry
} from "@/lib/api";

type BusyState = {
  tree: boolean;
  file: boolean;
  search: boolean;
  ask: boolean;
};

const INITIAL_BUSY: BusyState = {
  tree: false,
  file: false,
  search: false,
  ask: false
};

export default function Explorer() {
  const [busy, setBusy] = useState<BusyState>(INITIAL_BUSY);
  const [error, setError] = useState<string>("");

  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<TreeEntry[]>([]);

  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);

  const [contextPaths, setContextPaths] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [guidance, setGuidance] = useState("");
  const [contextPreview, setContextPreview] = useState<
    { path: string; preview: string }[]
  >([]);

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

  useEffect(() => {
    void loadTree("");
  }, []);

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

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (!searchQuery.trim()) {
      return;
    }

    try {
      setBusy((prev) => ({ ...prev, search: true }));
      setError("");
      const response = await searchCode(searchQuery.trim(), currentPath, 50);
      setSearchResults(response.matches);
    } catch (err) {
      setError((err as Error).message);
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
          <form className="search-form" onSubmit={runSearch}>
            <label htmlFor="search-input">Search code</label>
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
            <h3>Matches ({searchResults.length})</h3>
            <ul>
              {searchResults.map((match) => (
                <li key={`${match.path}:${match.line_number}`}>
                  <button type="button" onClick={() => void openFile(match.path)}>
                    <strong>{match.path}</strong>
                    <span>L{match.line_number}: {match.line}</span>
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
