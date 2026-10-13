/**
 * Shared Services / Treatments definitions used by BOTH the API routes
 * (server) and the Services page (client). No server-only imports so the
 * client bundle can reuse the same constants, types and helpers — one
 * source of truth.
 *
 * One service = one row of the `service` table, always scoped to the
 * authenticated business through `business_id` (never identified by name).
 */

export const SERVICE_STATUSES = ["active", "inactive"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/** API response shape (camelCase) for one service row. */
export type ServiceItem = {
  id: string;
  serviceTitle: string;
  category: string;
  status: ServiceStatus;
  createdAt: string;
  updatedAt: string;
};

/** Raw DB row shape as read from `service`. */
export type ServiceRow = {
  id: string;
  business_id: string;
  service_title: string;
  category: string;
  status: string;
  created_at: string;
  updated_at: string;
};

/** Map a raw DB row into the camelCase shape the frontend expects. */
export function mapService(row: ServiceRow): ServiceItem {
  return {
    id: row.id,
    serviceTitle: row.service_title,
    category: row.category,
    status: (row.status === "inactive" ? "inactive" : "active") as ServiceStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** User-facing badge label for a status value. */
export function serviceStatusLabel(status: string): string {
  return status === "inactive" ? "INACTIVE" : "ACTIVE";
}

// ---------------------------------------------------------------------------
// Server-side validation (the API is the source of truth; the form reuses
// the same rules so UI errors match the backend exactly).
// ---------------------------------------------------------------------------

export type ServiceInput = {
  serviceTitle?: unknown;
  category?: unknown;
  status?: unknown;
};

export type ServiceFieldErrors = Partial<
  Record<"serviceTitle" | "category" | "status", string>
>;

export type ServiceValidated = {
  serviceTitle: string;
  category: string;
  status: ServiceStatus;
};

export function validateService(
  raw: ServiceInput
): { ok: true; data: ServiceValidated } | { ok: false; errors: ServiceFieldErrors } {
  const errors: ServiceFieldErrors = {};

  // ---- serviceTitle (required, 2–255 chars) ----
  let serviceTitle = "";
  const titleRaw = typeof raw.serviceTitle === "string" ? raw.serviceTitle.trim() : "";
  if (titleRaw === "") {
    errors.serviceTitle = "Service title is required.";
  } else if (titleRaw.length < 2) {
    errors.serviceTitle = "Service title must be at least 2 characters.";
  } else if (titleRaw.length > 255) {
    errors.serviceTitle = "Service title must be 255 characters or fewer.";
  } else {
    serviceTitle = titleRaw;
  }

  // ---- category (required, 2–100 chars) ----
  let category = "";
  const categoryRaw = typeof raw.category === "string" ? raw.category.trim() : "";
  if (categoryRaw === "") {
    errors.category = "Category is required.";
  } else if (categoryRaw.length < 2) {
    errors.category = "Category must be at least 2 characters.";
  } else if (categoryRaw.length > 100) {
    errors.category = "Category must be 100 characters or fewer.";
  } else {
    category = categoryRaw;
  }

  // ---- status (required enum, defaults to active) ----
  let status: ServiceStatus = "active";
  const statusRaw =
    typeof raw.status === "string" && raw.status.trim() !== ""
      ? raw.status.trim().toLowerCase()
      : "active";
  const match = SERVICE_STATUSES.find((s) => s === statusRaw);
  if (!match) {
    errors.status = "Status must be Active or Inactive.";
  } else {
    status = match;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, data: { serviceTitle, category, status } };
}
