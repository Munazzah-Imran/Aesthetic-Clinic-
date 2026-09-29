import { NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

type TodoRow = {
  id: number;
  title: string;
  done: boolean;
};

export async function GET() {
  try {
    const result = await pool.query<TodoRow>(
      "SELECT id, title, done FROM todos ORDER BY id ASC"
    );
    return NextResponse.json({ todos: result.rows });
  } catch (err) {
    console.error("GET /api/todos failed:", err);
    return NextResponse.json(
      { error: "Failed to load todos" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (title.length > 200) {
      return NextResponse.json(
        { error: "title must be 200 characters or fewer" },
        { status: 400 }
      );
    }

    const result = await pool.query<TodoRow>(
      "INSERT INTO todos (title) VALUES ($1) RETURNING id, title, done",
      [title]
    );
    return NextResponse.json({ todo: result.rows[0] }, { status: 201 });
  } catch (err) {
    console.error("POST /api/todos failed:", err);
    return NextResponse.json(
      { error: "Failed to create todo" },
      { status: 500 }
    );
  }
}
