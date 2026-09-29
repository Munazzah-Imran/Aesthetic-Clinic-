import Image from "next/image";
import TodoList from "@/components/TodoList";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center px-6 py-16 gap-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <Image
          src="/next.svg"
          alt="Next.js logo"
          width={120}
          height={24}
          priority
        />
        <h1 className="text-3xl font-bold">Next.js + Docker + Postgres</h1>
        <p className="text-sm opacity-70">
          The list below is served from the Postgres container.
        </p>
      </div>

      <TodoList />

      <footer className="text-xs opacity-50">
        Edit <code>src/app/page.tsx</code> to get started — dev mode hot-reloads.
      </footer>
    </main>
  );
}
