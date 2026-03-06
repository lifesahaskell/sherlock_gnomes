import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="home-hero card">
        <p className="eyebrow">Sherlock Gnomes</p>
        <h1>AI Codebase Explorer</h1>
        <p>
          Search indexed code, inspect repository structure, and assemble precise context for
          AI-assisted development workflows.
        </p>
        <div className="home-actions">
          <Link href="/explorer" className="home-cta primary">
            Go to Explorer
          </Link>
          <Link href="/docs" className="home-cta secondary">
            Read Docs
          </Link>
        </div>
      </section>
    </main>
  );
}
