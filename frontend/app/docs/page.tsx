import Link from "next/link";

export default function DocsPage() {
  return (
    <main className="docs-shell">
      <section className="docs-card card">
        <p className="eyebrow">Documentation</p>
        <h1>Docs are coming soon</h1>
        <p>
          Setup and operational guides are being assembled. This placeholder route exists so the
          global navigation remains fully functional now.
        </p>
        <p>
          For immediate usage, open the explorer to browse files, run search, and build AI context
          from selected paths.
        </p>
        <Link href="/explorer" className="home-cta primary">
          Open Explorer
        </Link>
      </section>
    </main>
  );
}
