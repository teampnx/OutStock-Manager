import { useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import type { ActivityFeedItem, ActivityFeedTone } from "../lib/activity-format";
import { formatDateTime } from "../lib/format-datetime";
import { listActivityFeedForShop } from "../models/activity-log.server";
import { authenticate } from "../shopify.server";

const PAGE_SIZE = 20;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const activity = await listActivityFeedForShop(session.shop);
    return { activity, error: null };
  } catch {
    return {
      activity: [],
      error: "Could not load activity log. Please refresh the page.",
    };
  }
};

type ActivityFilter = "all" | "syncs" | "reorders" | "restores" | "errors";
type DateGroup = "Today" | "Yesterday" | "Earlier";

function matchesFilter(entry: ActivityFeedItem, filter: ActivityFilter): boolean {
  switch (filter) {
    case "syncs":
      return entry.category === "sync" || entry.category === "backfill";
    case "reorders":
      return entry.category === "move";
    case "restores":
      return entry.category === "restore";
    case "errors":
      return entry.tone === "critical";
    default:
      return true;
  }
}

function getDateGroup(iso: string): DateGroup {
  const entryDate = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const normalized = new Date(entryDate);
  normalized.setHours(0, 0, 0, 0);

  if (normalized.getTime() === today.getTime()) {
    return "Today";
  }
  if (normalized.getTime() === yesterday.getTime()) {
    return "Yesterday";
  }
  return "Earlier";
}

function toneIcon(tone: ActivityFeedTone) {
  switch (tone) {
    case "success":
      return { type: "check-circle-filled" as const, tone: "success" as const };
    case "warning":
      return { type: "alert-triangle" as const, tone: "warning" as const };
    case "critical":
      return { type: "alert-circle" as const, tone: "critical" as const };
    default:
      return { type: "info" as const, color: "subdued" as const };
  }
}

function toneBadge(tone: ActivityFeedTone) {
  switch (tone) {
    case "success":
      return "success" as const;
    case "warning":
      return "warning" as const;
    case "critical":
      return "critical" as const;
    default:
      return "info" as const;
  }
}

function categoryBadgeLabel(category: ActivityFeedItem["category"]) {
  switch (category) {
    case "move":
      return "Reorder";
    case "restore":
      return "Restore";
    case "sync":
      return "Sync";
    case "backfill":
      return "Backfill";
    case "skipped":
      return "Skipped";
    case "inventory":
      return "Inventory";
    default:
      return category;
  }
}

const FILTER_OPTIONS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "syncs", label: "Syncs" },
  { id: "reorders", label: "Reorders" },
  { id: "restores", label: "Restores" },
  { id: "errors", label: "Errors" },
];

function MetricCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: "success" | "warning" | "error";
}) {
  const variantClass =
    variant === "success"
      ? "activity-metric-success"
      : variant === "warning"
        ? "activity-metric-warning"
        : variant === "error"
          ? "activity-metric-error"
          : undefined;

  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="large"
      background="base"
    >
      <div className={variantClass}>
        <s-stack direction="block" gap="small-100">
          <p className="activity-metric-value">{value.toLocaleString()}</p>
          <p className="activity-metric-label">{label}</p>
        </s-stack>
      </div>
    </s-box>
  );
}

function ActivityTimelineRow({ entry }: { entry: ActivityFeedItem }) {
  const icon = toneIcon(entry.tone);

  return (
    <div className="activity-timeline-row">
      <s-icon
        type={icon.type}
        {...("tone" in icon ? { tone: icon.tone } : { color: icon.color })}
      />
      <div className="activity-timeline-main">
        <s-stack direction="inline" gap="small-100" alignItems="center">
          <p className="activity-timeline-title">{entry.title}</p>
          <s-badge tone={toneBadge(entry.tone)}>
            {categoryBadgeLabel(entry.category)}
          </s-badge>
        </s-stack>
        <p className="activity-timeline-description">{entry.description}</p>
      </div>
      <p className="activity-timeline-time">{formatDateTime(entry.occurredAt)}</p>
    </div>
  );
}

export default function ActivityPage() {
  const { activity, error } = useLoaderData<typeof loader>();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const summary = useMemo(
    () => ({
      total: activity.length,
      success: activity.filter((entry) => entry.tone === "success").length,
      warning: activity.filter((entry) => entry.tone === "warning").length,
      error: activity.filter((entry) => entry.tone === "critical").length,
    }),
    [activity],
  );

  const filterCounts = useMemo(() => {
    const counts: Record<ActivityFilter, number> = {
      all: activity.length,
      syncs: 0,
      reorders: 0,
      restores: 0,
      errors: 0,
    };

    for (const entry of activity) {
      if (matchesFilter(entry, "syncs")) counts.syncs += 1;
      if (matchesFilter(entry, "reorders")) counts.reorders += 1;
      if (matchesFilter(entry, "restores")) counts.restores += 1;
      if (matchesFilter(entry, "errors")) counts.errors += 1;
    }

    return counts;
  }, [activity]);

  const filteredActivity = useMemo(() => {
    const query = search.trim().toLowerCase();

    return activity.filter((entry) => {
      if (!matchesFilter(entry, filter)) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        entry.title.toLowerCase().includes(query) ||
        entry.description.toLowerCase().includes(query)
      );
    });
  }, [activity, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredActivity.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const pagedActivity = filteredActivity.slice(pageStart, pageEnd);

  const groupedPagedActivity = useMemo(() => {
    const groups: { label: DateGroup; entries: ActivityFeedItem[] }[] = [];
    const order: DateGroup[] = ["Today", "Yesterday", "Earlier"];

    for (const label of order) {
      const entries = pagedActivity.filter(
        (entry) => getDateGroup(entry.occurredAt) === label,
      );
      if (entries.length > 0) {
        groups.push({ label, entries });
      }
    }

    return groups;
  }, [pagedActivity]);

  useEffect(() => {
    setPage(1);
  }, [filter, search]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const rangeStart = filteredActivity.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageEnd, filteredActivity.length);

  return (
    <s-page heading="Activity Log" inlineSize="large">
      <s-link slot="primary-action" href="/app/dashboard">
        Dashboard
      </s-link>

      {error && (
        <s-banner tone="critical" heading="Unable to load activity">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      <s-stack direction="block" gap="large">
        <s-box
          padding="large"
          borderWidth="base"
          borderRadius="large"
          background="base"
        >
          <s-stack direction="block" gap="small-200">
            <p className="page-intro-title">Store activity timeline</p>
            <p className="page-intro-text">
              Product moves, restores, collection syncs, and inventory changes
              from your store appear here as they happen. Filter by type or
              search to find specific events.
            </p>
          </s-stack>
        </s-box>

        <s-grid gap="base" gridTemplateColumns="1fr 1fr 1fr 1fr">
          <MetricCard label="Total events" value={summary.total} />
          <MetricCard
            label="Success events"
            value={summary.success}
            variant="success"
          />
          <MetricCard
            label="Warning events"
            value={summary.warning}
            variant="warning"
          />
          <MetricCard label="Error events" value={summary.error} variant="error" />
        </s-grid>

        <s-box
          padding="none"
          borderWidth="base"
          borderRadius="large"
          background="base"
        >
          <s-box padding="base" background="subdued">
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="small-100">
                {FILTER_OPTIONS.map((option) => (
                  <s-clickable-chip
                    key={option.id}
                    color={filter === option.id ? "strong" : "base"}
                    onClick={() => setFilter(option.id)}
                  >
                    {option.label}{" "}
                    <span className="activity-filter-count">
                      ({filterCounts[option.id]})
                    </span>
                  </s-clickable-chip>
                ))}
              </s-stack>
              <s-search-field
                label="Search activity"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search by title or details"
                value={search}
                onInput={(event) => setSearch(event.currentTarget.value)}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
            </s-stack>
          </s-box>

          <s-box padding="none">
            {activity.length === 0 ? (
              <s-box padding="large">
                <s-paragraph>
                  <s-text color="subdued">No activity recorded yet.</s-text>
                </s-paragraph>
              </s-box>
            ) : filteredActivity.length === 0 ? (
              <s-box padding="large">
                <s-paragraph>
                  <s-text color="subdued">
                    No events match your search or filter.
                  </s-text>
                </s-paragraph>
              </s-box>
            ) : (
              <>
                <div className="activity-timeline">
                  {groupedPagedActivity.map((group) => (
                    <div key={group.label}>
                      <div className="timeline-group-label">{group.label}</div>
                      {group.entries.map((entry) => (
                        <ActivityTimelineRow key={entry.id} entry={entry} />
                      ))}
                    </div>
                  ))}
                </div>
                {filteredActivity.length > PAGE_SIZE ? (
                  <div className="pagination-bar">
                    <p className="pagination-summary">
                      Showing {rangeStart}–{rangeEnd} of{" "}
                      {filteredActivity.length.toLocaleString()} events
                    </p>
                    <s-stack direction="inline" gap="small-100" alignItems="center">
                      <s-button
                        variant="secondary"
                        icon="chevron-left"
                        accessibilityLabel="Previous page"
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                        disabled={currentPage <= 1}
                      />
                      <s-text>
                        Page {currentPage} of {totalPages}
                      </s-text>
                      <s-button
                        variant="secondary"
                        icon="chevron-right"
                        accessibilityLabel="Next page"
                        onClick={() =>
                          setPage((current) => Math.min(totalPages, current + 1))
                        }
                        disabled={currentPage >= totalPages}
                      />
                    </s-stack>
                  </div>
                ) : null}
              </>
            )}
          </s-box>
        </s-box>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
