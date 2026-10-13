"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Loads GET /api/auth/permissions — the CURRENT user's role and permission
 * keys exactly as the SERVER resolved them from PostgreSQL. The client only
 * ever reads this for UI decisions (sidebar filtering, Access Denied); the
 * authoritative enforcement lives in requirePermission() on every API route.
 *
 * A module-level cache shares ONE fetch between every consumer (layout,
 * sidebar, navbar) for the life of the page. Permission changes therefore
 * apply on the next refresh/re-login (or an explicit refresh() call) — and
 * always apply to API calls immediately, because the server re-reads
 * permissions per request regardless of this cache.
 */

const TOKEN_STORAGE_KEY = "token";

export type PermissionsData = {
  role: "admin" | "staff";
  isAdmin: boolean;
  permissions: string[];
  mustChangePassword: boolean;
  designation: string | null;
  staffId: string | null;
  membershipId: string | null;
};

type CacheState = {
  data: PermissionsData | null;
  error: boolean;
  unauthenticated: boolean;
};

const EMPTY: CacheState = { data: null, error: false, unauthenticated: false };

let cache: CacheState = EMPTY;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(state: CacheState) => void>();

function emit(): void {
  for (const listener of listeners) listener(cache);
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function load(): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const token = readToken();
      if (!token) {
        cache = { data: null, error: false, unauthenticated: true };
        emit();
        return;
      }

      const response = await fetch("/api/auth/permissions", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        // Token invalid/expired or the account was deactivated — drop it so
        // useAuthMe/login flows behave exactly like they do today.
        try {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
        } catch {
          // Storage unavailable.
        }
        cache = { data: null, error: false, unauthenticated: true };
        emit();
        return;
      }

      const json = (await response.json()) as {
        data: PermissionsData | null;
        success: boolean;
      };

      if (!response.ok || !json.success || !json.data) {
        cache = { data: null, error: true, unauthenticated: false };
        emit();
        return;
      }

      cache = { data: json.data, error: false, unauthenticated: false };
      emit();
    } catch {
      cache = { data: null, error: true, unauthenticated: false };
      emit();
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

type UsePermissionsResult = {
  data: PermissionsData | null;
  loading: boolean;
  error: boolean;
  unauthenticated: boolean;
  /** Re-fetch (keeps the cache until the response arrives). */
  retry: () => void;
  /** Drop the cache and re-fetch (used after actions that change access). */
  refresh: () => Promise<void>;
};

export function usePermissions(): UsePermissionsResult {
  const [state, setState] = useState<CacheState>(cache);

  useEffect(() => {
    const listener = (next: CacheState) => setState(next);
    listeners.add(listener);
    if (!cache.data && !cache.error && !cache.unauthenticated && !inFlight) {
      void load();
    } else {
      setState(cache);
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const retry = useCallback(() => {
    void load();
  }, []);

  const refresh = useCallback(async () => {
    cache = EMPTY;
    emit();
    await load();
  }, []);

  return {
    data: state.data,
    loading: !state.data && !state.error && !state.unauthenticated,
    error: state.error,
    unauthenticated: state.unauthenticated,
    retry,
    refresh,
  };
}

/**
 * Convenience for components that need one permission right away.
 * Admins hold every key, so `isAdmin` short-circuits to true.
 */
export function hasPermission(
  data: PermissionsData | null,
  key: string
): boolean {
  if (!data) return false;
  if (data.isAdmin) return true;
  return data.permissions.includes(key);
}
