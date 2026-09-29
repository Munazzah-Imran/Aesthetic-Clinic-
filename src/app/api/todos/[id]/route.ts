import { NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

type TodoRow = {
  id: number;
  title: string;
  done: boolean;
};

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const todoId = Number(id);

    if (!Number.isInteger(todoId) || todoId <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const body = (await request.json()) as { done?: unknown };
    if (typeof body.done !== "boolean") {
      return NextResponse.json(
        { error: "done must be a boolean" },
        { status: 400 }
      );
    }

    const result = await pool.query<TodoRow>(
      "UPDATE todos SET done = $1 WHERE id = $2 RETURNING id, title, done",
      [body.done, todoId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "todo not found" }, { status: 404 });
    }

    return NextResponse.json({ todo: result.rows[0] });
  } catch (err) {
    console.error("PATCH /api/todos/[id] failed:", err);
    return NextResponse.json(
      { error: "Failed to update todo" },
      { status: 500 }
    );
  }
}
