"use client";

import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "@/lib/useAuthMe";
import type { DashboardData } from "@/lib/dashboardTypes";

type UseDashboardDataResult = {
  /** Latest payload; null until the first successful response. */
  data: DashboardData | null;
  /** True only while there is no data yet (skeleton state, never fake 0s). */
  loading: boolean;
  /** True when the last load failed AND we have no data to show. */
  error: boolean;
  /** Refetch (used by Retry and after navigating back to the dashboard). */
  reload: () => void;
};

/**
 * Loads GET /api/dashboard (counts + lists for the authenticated business).
 *
 * - Refetches whenever the dashboard page mounts, so data added on the
 *   Patients/Doctors/Appointments pages shows up without a manual browser
 *   refresh (App Router remounts the page component on navigation).
 * - Also refetches when the tab regains focus for an extra safety net.
 */
export function useDashboardData(): UseDashboardDataResult {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const result = (await response.json().catch(() => null)) as {
        data: DashboardData | null;
        success: boolean;
      } | null;

      if (!response.ok || !result?.success || !result.data) {
        // Keep stale data if we have it; only surface the error when empty.
        setError(true);
        return;
      }
      setData(result.data);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();

    const onFocus = () => {
      void reload();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [reload]);

  return { data, loading, error, reload };
}
