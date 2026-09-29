"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const TOKEN_STORAGE_KEY = "token";

/**
 * Authorization headers for direct client fetches (form submits, detail
 * modals) that do not go through authFetch(). Attaches the same stored JWT
 * so POSTs/PATCHes/GETs reach requireAuth() instead of failing 401.
 */
export function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {}
  }
}

export type MeData = {
  user: { id: number; name: string; email: string; business_id: string | null };
  business: { id: string; business_name: string; email: string } | null;
};

type UseAuthMeResult = {
  me: MeData | null;
  loading: boolean;
  loadError: boolean;
  retry: () => void;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
};

/**
 * Loads the authenticated user + business from the existing
 * GET /api/auth/me endpoint. Redirects to /login when unauthenticated.
 *
 * authFetch() attaches the stored JWT to other API calls.
 */
export function useAuthMe(): UseAuthMeResult {
  const router = useRouter();
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchMe = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      let token: string | null = null;
      try {
        token = localStorage.getItem(TOKEN_STORAGE_KEY);
      } catch {
        token = null;
      }

      if (!token) {
        router.replace("/login");
        return;
      }

      const response = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        try {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
        } catch {
          // ignore storage errors
        }
        router.replace("/login");
        return;
      }

      const result = (await response.json()) as {
        data: MeData | null;
        success: boolean;
      };

      if (!response.ok || !result.success || !result.data) {
        setLoadError(true);
        return;
      }

      setMe(result.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const authFetch = useCallback(
    async (input: string, init?: RequestInit): Promise<Response> => {
      let token: string | null = null;
      try {
        token = localStorage.getItem(TOKEN_STORAGE_KEY);
      } catch {
        token = null;
      }
      const headers = new Headers(init?.headers);
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return fetch(input, { ...init, headers });
    },
    []
  );

  return { me, loading, loadError, retry: fetchMe, authFetch };
}
