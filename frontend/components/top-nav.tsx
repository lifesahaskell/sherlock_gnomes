"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/explorer", label: "Explorer" },
  { href: "/docs", label: "Docs" },
  { href: "/profile", label: "Profile" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function TopNav() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="site-nav">
      <div className="site-nav-inner">
        <Link href="/" className="site-brand" aria-label="Sherlock Gnomes Home">
          <span className="site-brand-eyebrow">Sherlock Gnomes</span>
          <span className="site-brand-title">AI Codebase Explorer</span>
        </Link>
        <nav aria-label="Primary">
          <ul className="site-links">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`site-link${isActive(pathname, item.href) ? " active" : ""}`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
