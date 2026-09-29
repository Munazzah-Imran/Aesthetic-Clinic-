"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type AuthResponse = {
  data: {
    id?: number;
    name?: string;
    email?: string;
      user?: {
      id: number;
      name: string;
      email: string;
      business_id?: string;
    };
    business?: {
      id: string;
      business_name: string;
      email: string;
    };
    token?: string;
  } | null;
  error: string | null;
  success: boolean;
  message: string;
};

const TOKEN_STORAGE_KEY = "token";

export default function AuthForm() {
  const router = useRouter();

  const [loginLoading, setLoginLoading] = useState(false);
  const [loginMessage, setLoginMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [signupLoading, setSignupLoading] = useState(false);
  const [signupMessage, setSignupMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Refs let us switch the CSS-only tabs after actions (e.g. signup -> login).
  const tabLoginRef = useRef<HTMLInputElement>(null);
  const tabSignupRef = useRef<HTMLInputElement>(null);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginMessage(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    setLoginLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json()) as AuthResponse;

      if (response.ok && result.success && result.data?.token) {
        // Keep the JWT available for authenticated API requests.
        try {
          localStorage.setItem(TOKEN_STORAGE_KEY, result.data.token);
        } catch {
          // Storage unavailable (e.g. private mode) — continue without persisting.
        }
        setLoginMessage({ type: "success", text: result.message });
        // No full page reload — go straight to the authenticated dashboard.
        router.push("/dashboard");
        router.refresh();
      } else {
        const text =
          result.error ?? "Login failed. Please try again.";
        setLoginMessage({ type: "error", text });

        // No account with this email — guide the user to sign up first.
        if (text.includes("sign up first")) {
          const loginEmail = String(formData.get("email") ?? "").trim();
          const signupEmailInput = document.getElementById(
            "signup-email"
          ) as HTMLInputElement | null;
          if (signupEmailInput && !signupEmailInput.value) {
            signupEmailInput.value = loginEmail;
          }
          setSignupMessage({
            type: "error",
            text: "Please create an account first then log in.",
          });
          tabSignupRef.current?.click();
        }
      }
    } catch {
      setLoginMessage({
        type: "error",
        text: "Could not reach the server. Please try again.",
      });
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSignupMessage(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const businessName = String(formData.get("businessName") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    // Frontend guard: never send mismatched passwords to the API.
    if (password !== confirmPassword) {
      setSignupMessage({ type: "error", text: "Passwords do not match" });
      return;
    }

    setSignupLoading(true);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, name, email, password }),
      });
      const result = (await response.json()) as AuthResponse;

      if (response.ok && result.success) {
        setSignupMessage({
          type: "success",
          text: result.message + " You can log in now.",
        });
        // Signup succeeded — clear the earlier "please sign up first" login error.
        setLoginMessage(null);
        form.reset();
        // Switch to the login tab so the new user can sign in.
        tabLoginRef.current?.click();
      } else {
        setSignupMessage({
          type: "error",
          text: result.error ?? "Signup failed. Please try again.",
        });
      }
    } catch {
      setSignupMessage({
        type: "error",
        text: "Could not reach the server. Please try again.",
      });
    } finally {
      setSignupLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-bg" />

      <div className="auth-card">
        {/* Hidden radio inputs drive the CSS-only tab switching */}
        <input
          ref={tabLoginRef}
          className="auth-tabs"
          type="radio"
          name="auth-tab"
          id="tab-login"
          defaultChecked
        />
        <input
          ref={tabSignupRef}
          className="auth-tabs"
          type="radio"
          name="auth-tab"
          id="tab-signup"
        />

        {/* Logo + heading */}
        <div className="auth-logo">CL</div>
        <h1 className="auth-title">Welcome to Clinic</h1>
        <p className="auth-subtitle">
          Login or create an account to continue
        </p>

        {/* Tab labels */}
        <div className="auth-tab-labels">
          <label htmlFor="tab-login">Login</label>
          <label htmlFor="tab-signup">Sign Up</label>
        </div>

        {/* ---------- LOGIN PANEL ---------- */}
        <form className="auth-panel-login" onSubmit={handleLogin}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="login-email">
              Email
            </label>
            <input
              className="auth-input"
              type="email"
              id="login-email"
              name="email"
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="auth-field">
            <div className="auth-row">
              <label className="auth-label" htmlFor="login-password">
                Password
              </label>
              <a className="auth-forgot" href="#">
                Forgot password?
              </a>
            </div>
            <input
              className="auth-input"
              type="password"
              id="login-password"
              name="password"
              placeholder="••••••••"
              minLength={6}
              required
            />
          </div>

          {loginMessage && (
            <p
              className={`auth-message ${
                loginMessage.type === "success"
                  ? "auth-message-success"
                  : "auth-message-error"
              }`}
              role="status"
            >
              {loginMessage.text}
            </p>
          )}

          <button className="auth-submit" type="submit" disabled={loginLoading}>
            {loginLoading ? "Logging in…" : "Login"}
          </button>
        </form>

        {/* ---------- SIGNUP PANEL ---------- */}
        <form className="auth-panel-signup" onSubmit={handleSignup}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="signup-business-name">
              Business name
            </label>
            <input
              className="auth-input"
              type="text"
              id="signup-business-name"
              name="businessName"
              placeholder="e.g. Ali Beauty Clinic"
              maxLength={100}
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="signup-name">
              Full name
            </label>
            <input
              className="auth-input"
              type="text"
              id="signup-name"
              name="name"
              placeholder="Ali Khan"
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="signup-email">
              Email
            </label>
            <input
              className="auth-input"
              type="email"
              id="signup-email"
              name="email"
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="signup-password">
              Password
            </label>
            <input
              className="auth-input"
              type="password"
              id="signup-password"
              name="password"
              placeholder="••••••••"
              minLength={6}
              required
            />
            <p className="auth-hint">Must be at least 6 characters</p>
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="signup-confirm-password">
              Confirm Password
            </label>
            <input
              className="auth-input"
              type="password"
              id="signup-confirm-password"
              name="confirmPassword"
              placeholder="••••••••"
              minLength={6}
              required
            />
          </div>

          {signupMessage && (
            <p
              className={`auth-message ${
                signupMessage.type === "success"
                  ? "auth-message-success"
                  : "auth-message-error"
              }`}
              role="status"
            >
              {signupMessage.text}
            </p>
          )}

          <button
            className="auth-submit"
            type="submit"
            disabled={signupLoading}
          >
            {signupLoading ? "Creating account…" : "Create account"}
          </button>
        </form>

        {/* Divider + social buttons */}
        <div className="auth-divider">
          <span>or continue with</span>
        </div>
        <div className="auth-social">
          <button type="button">Google</button>
          <button type="button">GitHub</button>
        </div>

        {/* Footer switch */}
        <p className="auth-footer">
          <span className="auth-footer-login">
            Don&apos;t have an account?{" "}
            <label htmlFor="tab-signup">Sign up</label>
          </span>
          <span className="auth-footer-signup">
            Already have an account? <label htmlFor="tab-login">Login</label>
          </span>
        </p>
      </div>
    </div>
  );
}
