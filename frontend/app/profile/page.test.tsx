import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "@/app/profile/page";
import { createProfileAdmin } from "@/lib/profile-admin";

vi.mock("@/lib/profile-admin", () => ({
  createProfileAdmin: vi.fn()
}));

const mockedCreateProfileAdmin = vi.mocked(createProfileAdmin);

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateProfileAdmin.mockResolvedValue({
      id: 1,
      display_name: "Ada Lovelace",
      email: "ada@example.com",
      bio: "Pioneer",
      created_at: "2026-03-06T00:00:00Z"
    });
  });

  it("renders profile creation form and explorer navigation link", () => {
    render(<ProfilePage />);

    expect(screen.getByRole("heading", { name: "Create Profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Profile name")).toBeInTheDocument();
    expect(screen.getByLabelText("Profile email")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Explorer" })).toHaveAttribute(
      "href",
      "/explorer"
    );
  });

  it("submits trimmed values and renders latest profile summary", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.type(screen.getByLabelText("Profile name"), " Ada Lovelace ");
    await user.type(screen.getByLabelText("Profile email"), " ADA@EXAMPLE.COM ");
    await user.type(screen.getByLabelText("Profile bio"), " Pioneer ");
    await user.click(screen.getByRole("button", { name: "Create Profile" }));

    await waitFor(() => {
      expect(mockedCreateProfileAdmin).toHaveBeenCalledWith({
        display_name: "Ada Lovelace",
        email: "ADA@EXAMPLE.COM",
        bio: "Pioneer"
      });
    });

    expect(screen.getByText("Latest Profile")).toBeInTheDocument();
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(screen.getByText(/\(ada@example.com\)/)).toBeInTheDocument();
  });

  it("validates required fields before submit", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole("button", { name: "Create Profile" }));
    expect(screen.getByText("Profile name is required.")).toBeInTheDocument();
    expect(mockedCreateProfileAdmin).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Profile name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Create Profile" }));
    expect(screen.getByText("Profile email is required.")).toBeInTheDocument();
    expect(mockedCreateProfileAdmin).not.toHaveBeenCalled();
  });

  it("shows API error message when profile creation fails", async () => {
    const user = userEvent.setup();
    mockedCreateProfileAdmin.mockRejectedValue(new Error("admin API key required"));

    render(<ProfilePage />);

    await user.type(screen.getByLabelText("Profile name"), "Ada");
    await user.type(screen.getByLabelText("Profile email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Create Profile" }));

    await waitFor(() => {
      expect(screen.getByText("admin API key required")).toBeInTheDocument();
    });
  });
});
