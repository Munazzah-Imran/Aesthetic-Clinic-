import type { LucideIcon } from "lucide-react";

type StatCardProps = {
  icon: LucideIcon;
  title: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
  /** Shows a subtle skeleton instead of a value while real data loads. */
  loading?: boolean;
};

export default function StatCard({ icon: Icon, title, value, trend, trendUp = true, loading = false }: StatCardProps) {
  return (
    <div className="group rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 transition-all hover:border-sky-500/40 hover:shadow-lg hover:shadow-sky-500/5">
      <div className="flex items-start justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 transition-colors group-hover:bg-sky-500/25">
          <Icon size={20} />
        </div>
        {trend && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              trendUp
                ? "bg-sky-500/15 text-sky-600"
                : "bg-red-500/15 text-red-600"
            }`}
          >
            {trend}
          </span>
        )}
      </div>
      <p className="mt-4 text-2xl font-bold text-slate-900">
        {loading ? (
          <span className="inline-block h-7 w-14 animate-pulse rounded-md bg-[#E2E8F0]" />
        ) : (
          value
        )}
      </p>
      <p className="mt-1 text-sm text-[#5B6B7C]">{title}</p>
    </div>
  );
}
