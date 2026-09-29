import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">404 — Page not found</h1>
      <Link href="/" className="text-sm underline opacity-70">
        Back home
      </Link>
    </main>
  );
}
