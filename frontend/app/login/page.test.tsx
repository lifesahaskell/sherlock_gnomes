import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: vi.fn(),
  }),
}));

const mockPush = vi.fn();
const mockReplace = vi.fn();

describe("LoginPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockPush.mockClear();
    mockReplace.mockClear();
  });

  it("renders username and password fields with a submit button", async () => {
    const LoginPage = (await import("./page")).default;
    render(<LoginPage />);

    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log in/i })).toBeInTheDocument();
  });

  it("renders a page heading", async () => {
    const LoginPage = (await import("./page")).default;
    render(<LoginPage />);

    expect(screen.getByRole("heading", { name: /log in/i })).toBeInTheDocument();
  });

  it("submits plain credentials and redirects on success", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(global.fetch);

    // Single call: login succeeds (no public key fetch needed)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const LoginPage = (await import("./page")).default;
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), "admin");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    await vi.waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });

    // Verify login was called with plain credentials (not encrypted)
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({
      method: "POST",
    }));

    // Should NOT have fetched a public key
    expect(mockFetch).not.toHaveBeenCalledWith("/api/auth/public-key", expect.anything());

    // Verify the body contains plain password
    const callArgs = mockFetch.mock.calls[0];
    const requestInit = callArgs[1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as { username: string; password: string };
    expect(body.username).toBe("admin");
    expect(body.password).toBe("secret123");
  });

  it("displays an error message on login failure", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );

    const LoginPage = (await import("./page")).default;
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), "admin");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByText(/invalid username or password/i)).toBeInTheDocument();
  });

  it("displays rate limit message on 429", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Too many login attempts. Please try again later." }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "600" },
      })
    );

    const LoginPage = (await import("./page")).default;
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), "admin");
    await user.type(screen.getByLabelText(/password/i), "anything");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByText(/too many login attempts/i)).toBeInTheDocument();
  });
});
