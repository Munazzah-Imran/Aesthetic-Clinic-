import { redirect } from "next/navigation";

/**
 * Site root — the dashboard is the real entry point of the app.
 * Unauthenticated visitors are sent to /dashboard, whose layout immediately
 * redirects them to /login.
 */
export default function Home() {
  redirect("/dashboard");
}
