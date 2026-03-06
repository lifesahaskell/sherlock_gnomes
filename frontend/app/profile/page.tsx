"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { UserProfile } from "@/lib/api";
import { createProfileAdmin } from "@/lib/profile-admin";

export default function ProfilePage() {
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdProfile, setCreatedProfile] = useState<UserProfile | null>(null);

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
      setBusy(true);
      setError("");
      const profile = await createProfileAdmin({ display_name, email, bio });
      setCreatedProfile(profile);
      setProfileName("");
      setProfileEmail("");
      setProfileBio("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="profile-shell">
      <section className="profile-page-card card">
        <p className="eyebrow">Profile</p>
        <h1>Create Profile</h1>
        <p>
          Create a profile for identity-aware workflows. Profile edits remain available from the
          Explorer profile list.
        </p>

        {error ? <p className="error-banner">{error}</p> : null}

        <form className="profile-page-form" onSubmit={submitProfile}>
          <label htmlFor="profile-page-name-input">Profile name</label>
          <input
            id="profile-page-name-input"
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
            placeholder="Ada Lovelace"
          />
          <label htmlFor="profile-page-email-input">Profile email</label>
          <input
            id="profile-page-email-input"
            value={profileEmail}
            onChange={(event) => setProfileEmail(event.target.value)}
            placeholder="ada@example.com"
            type="email"
          />
          <label htmlFor="profile-page-bio-input">Profile bio</label>
          <textarea
            id="profile-page-bio-input"
            value={profileBio}
            onChange={(event) => setProfileBio(event.target.value)}
            placeholder="Short introduction"
          />
          <button type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create Profile"}
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

        <div className="profile-page-actions">
          <Link href="/explorer" className="home-cta secondary">
            Back to Explorer
          </Link>
        </div>
      </section>
    </main>
  );
}
