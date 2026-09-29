"use client";

import { useEffect, useState, useTransition } from "react";

type Todo = {
  id: number;
  title: string;
  done: boolean;
};

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();

  async function refresh() {
    const res = await fetch("/api/todos", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load todos (${res.status})`);
    const data = (await res.json()) as { todos: Todo[] };
    setTodos(data.todos);
  }

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function addTodo(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    setError(null);
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    if (!res.ok) {
      setError(`Failed to add todo (${res.status})`);
      return;
    }
    setTitle("");
    startTransition(() => {
      refresh().catch((err: Error) => setError(err.message));
    });
  }

  async function toggleTodo(id: number, done: boolean) {
    setError(null);
    const res = await fetch(`/api/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !done }),
    });
    if (!res.ok) {
      setError(`Failed to update todo (${res.status})`);
      return;
    }
    setTodos((prev) =>
      prev ? prev.map((t) => (t.id === id ? { ...t, done: !done } : t)) : prev
    );
  }

  return (
    <div className="w-full">
      <form onSubmit={addTodo} className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a todo…"
          className="flex-1 rounded-md border border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-white/50"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-2">
        {todos === null && <li className="text-sm opacity-60">Loading…</li>}
        {todos?.length === 0 && (
          <li className="text-sm opacity-60">No todos yet — add one above.</li>
        )}
        {todos?.map((todo) => (
          <li
            key={todo.id}
            className="flex items-center gap-3 rounded-md border border-white/10 px-3 py-2"
          >
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() => toggleTodo(todo.id, todo.done)}
              className="h-4 w-4 accent-current"
            />
            <span className={todo.done ? "line-through opacity-50" : ""}>
              {todo.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
