"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import axios from "axios";
import { useWallet } from "@/hooks/use-wallet";
import type { Notification, NotificationType } from "@/types";

const ICONS: Record<NotificationType, string> = {
  contribution: "💰",
  loan: "🏧",
  vote: "🗳️",
  distribution: "📤",
};

// TODO: connect to API — replace mock fallback once backend endpoint exists
async function fetchNotifications(recipient: string): Promise<Notification[]> {
  try {
    const { data } = await axios.get<Notification[]>("/api/notifications", {
      params: { recipient },
    });
    return data;
  } catch {
    const now = Date.now();
    return [
      {
        id: "mock-1",
        type: "contribution",
        recipient,
        message: "Adaeze contributed 50 USDC to Eko Savings",
        read: false,
        createdAt: new Date(now - 1000 * 60 * 12).toISOString(),
      },
      {
        id: "mock-2",
        type: "loan",
        recipient,
        message: "Your loan request of 200 USDC was approved",
        read: false,
        createdAt: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
      },
      {
        id: "mock-3",
        type: "vote",
        recipient,
        message: "New proposal: Raise monthly contribution to 75 USDC",
        read: true,
        createdAt: new Date(now - 1000 * 60 * 60 * 26).toISOString(),
      },
      {
        id: "mock-4",
        type: "distribution",
        recipient,
        message: "You received 12.4 USDC from Q2 dividend distribution",
        read: true,
        createdAt: new Date(now - 1000 * 60 * 60 * 24 * 4).toISOString(),
      },
    ];
  }
}

async function markRead(id: string): Promise<void> {
  // TODO: connect to API — backend PATCH endpoint
  await axios.patch(`/api/notifications/${id}/read`).catch(() => {
    /* swallow until backend exists */
  });
}

function ShellCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 h-64 flex flex-col">
      {children}
    </div>
  );
}

export function RecentActivity() {
  const { address } = useWallet();
  const queryClient = useQueryClient();

  const { data: notifications, isLoading, isError } = useQuery({
    queryKey: ["notifications", address],
    queryFn: () => fetchNotifications(address!),
    enabled: !!address,
  });

  const markAllRead = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => markRead(id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", address] });
    },
  });

  if (!address) {
    return (
      <ShellCard>
        <div className="m-auto text-sm text-gray-400">
          Connect your wallet to see activity
        </div>
      </ShellCard>
    );
  }

  if (isLoading) {
    return (
      <ShellCard>
        <div className="m-auto text-sm text-gray-400">Loading activity…</div>
      </ShellCard>
    );
  }

  if (isError) {
    return (
      <ShellCard>
        <div className="m-auto text-sm text-red-500">
          Failed to load activity
        </div>
      </ShellCard>
    );
  }

  const items = notifications ?? [];

  if (items.length === 0) {
    return (
      <ShellCard>
        <div className="m-auto text-sm text-gray-400">No recent activity</div>
      </ShellCard>
    );
  }

  const unreadIds = items.filter((n) => !n.read).map((n) => n.id);

  return (
    <ShellCard>
      <div className="flex items-center justify-between pb-2 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">Recent Activity</h3>
        {unreadIds.length > 0 && (
          <button
            type="button"
            onClick={() => markAllRead.mutate(unreadIds)}
            disabled={markAllRead.isPending}
            className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            Mark all read
          </button>
        )}
      </div>

      <ul className="flex-1 overflow-y-auto divide-y divide-gray-100 mt-1">
        {items.map((n) => (
          <li
            key={n.id}
            className={`flex items-start gap-3 py-2.5 ${
              n.read ? "opacity-70" : ""
            }`}
          >
            <span className="text-lg leading-none" aria-hidden>
              {ICONS[n.type]}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 truncate">{n.message}</p>
              <p className="text-xs text-gray-400">
                {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
              </p>
            </div>
            {!n.read && (
              <span
                className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0"
                aria-label="unread"
              />
            )}
          </li>
        ))}
      </ul>
    </ShellCard>
  );
}
