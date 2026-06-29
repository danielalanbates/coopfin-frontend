"use client";

import { useState, useMemo } from "react";
import { useParams, notFound } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  DollarSign,
  CreditCard,
  TrendingUp,
  Copy,
  Check,
  UserPlus,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { formatAmount, shortenAddress } from "@/lib/stellar";
import { useWallet } from "@/hooks/use-wallet";
import { LoanCard } from "@/components/loans/loan-card";
import { ProposalCard } from "@/components/governance/proposal-card";
import { format } from "date-fns";
import { clsx } from "clsx";
import type { Group, Member, Contribution, Loan, Proposal } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const STELLAR_NETWORK =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as string) || "TESTNET";
const EXPLORER_BASE =
  STELLAR_NETWORK === "MAINNET"
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet";

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 404) {
    const err = new Error("Not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

const TABS = ["Members", "Contributions", "Loans", "Governance"] as const;
type Tab = (typeof TABS)[number];

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [activeTab, setActiveTab] = useState<Tab>("Members");
  const [copied, setCopied] = useState(false);
  const { address: walletAddress } = useWallet();

  const groupQuery = useQuery({
    queryKey: ["group", id],
    queryFn: () => fetchJSON<Group>(`${API_URL}/api/groups/${id}`),
    enabled: !!id,
    retry: (failureCount, error) => {
      const status = (error as Error & { status?: number })?.status;
      if (status === 404) return false;
      return failureCount < 2;
    },
  });

  const membersQuery = useQuery({
    queryKey: ["group", id, "members"],
    queryFn: () => fetchJSON<Member[]>(`${API_URL}/api/groups/${id}/members`),
    enabled: !!id && activeTab === "Members",
  });

  const contributionsQuery = useQuery({
    queryKey: ["group", id, "contributions"],
    queryFn: () =>
      fetchJSON<Contribution[]>(`${API_URL}/api/groups/${id}/contributions`),
    enabled: !!id && activeTab === "Contributions",
  });

  const loansQuery = useQuery({
    queryKey: ["group", id, "loans"],
    queryFn: () => fetchJSON<Loan[]>(`${API_URL}/api/groups/${id}/loans`),
    enabled: !!id && activeTab === "Loans",
  });

  const proposalsQuery = useQuery({
    queryKey: ["group", id, "proposals"],
    queryFn: () =>
      fetchJSON<Proposal[]>(`${API_URL}/api/groups/${id}/proposals`),
    enabled: !!id && activeTab === "Governance",
  });

  const balanceQuery = useQuery({
    queryKey: ["group", id, "balance"],
    queryFn: () =>
      fetchJSON<{ balance: number }>(`${API_URL}/api/groups/${id}/balance`),
    enabled: !!id,
    refetchInterval: 15_000,
  });

  const group = groupQuery.data;
  const isAdmin = useMemo(
    () => !!group && !!walletAddress && group.admin === walletAddress,
    [group, walletAddress]
  );

  const activeLoansCount = useMemo(() => {
    const loans = loansQuery.data;
    if (loans) return loans.filter((l) => l.status === "Approved").length;
    return null;
  }, [loansQuery.data]);

  if (groupQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-24 bg-gray-100 animate-pulse rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 animate-pulse rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-gray-100 animate-pulse rounded-xl" />
      </div>
    );
  }

  if (groupQuery.isError) {
    const status = (groupQuery.error as Error & { status?: number })?.status;
    if (status === 404) return notFound();
    return (
      <div className="flex flex-col items-center py-20 text-gray-400 gap-2">
        <AlertCircle className="w-8 h-8" />
        <p>Failed to load group.</p>
      </div>
    );
  }

  if (!group) return notFound();

  const copyAdmin = async () => {
    try {
      await navigator.clipboard.writeText(group.admin);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const liveBalance = balanceQuery.data?.balance ?? group.balance;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 break-words">
                {group.name}
              </h1>
              <span
                className={clsx(
                  "text-xs px-2 py-0.5 rounded-full font-medium",
                  group.isActive
                    ? "bg-green-50 text-green-700"
                    : "bg-gray-100 text-gray-500"
                )}
              >
                {group.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="text-sm text-gray-600 mt-1.5 max-w-2xl">
              {group.description}
            </p>
            <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
              <span>Admin:</span>
              <code className="font-mono text-gray-700">
                {shortenAddress(group.admin)}
              </code>
              <button
                onClick={copyAdmin}
                className="text-gray-400 hover:text-gray-700 transition-colors"
                aria-label="Copy admin address"
                title="Copy admin address"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {isAdmin && (
            <button
              className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium self-start"
              type="button"
            >
              <UserPlus className="w-4 h-4" />
              Add Member
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={DollarSign}
          label="Treasury Balance"
          value={
            balanceQuery.isLoading && balanceQuery.data === undefined
              ? "…"
              : `$${formatAmount(liveBalance)}`
          }
          sub="USDC"
        />
        <StatCard
          icon={Users}
          label="Members"
          value={group.members.length.toString()}
        />
        <StatCard
          icon={CreditCard}
          label="Active Loans"
          value={activeLoansCount !== null ? activeLoansCount.toString() : "—"}
        />
        <StatCard
          icon={TrendingUp}
          label="Total Contributions"
          value={`$${formatAmount(group.totalContributions)}`}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
              activeTab === tab
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Members" && (
        <MembersTab
          members={membersQuery.data ?? group.members}
          isLoading={membersQuery.isLoading}
        />
      )}
      {activeTab === "Contributions" && (
        <ContributionsTab
          contributions={contributionsQuery.data ?? []}
          isLoading={contributionsQuery.isLoading}
        />
      )}
      {activeTab === "Loans" && (
        <LoansTab
          loans={loansQuery.data ?? []}
          isLoading={loansQuery.isLoading}
        />
      )}
      {activeTab === "Governance" && (
        <GovernanceTab
          proposals={proposalsQuery.data ?? []}
          isLoading={proposalsQuery.isLoading}
        />
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 text-gray-400 mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-xl font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function MembersTab({
  members,
  isLoading,
}: {
  members: Member[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <div className="h-40 bg-gray-100 animate-pulse rounded-xl" />;
  }
  if (members.length === 0) {
    return <EmptyState message="No members yet." />;
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-3">Address</th>
            <th className="text-left px-4 py-3">Display Name</th>
            <th className="text-right px-4 py-3">Total Contributed</th>
            <th className="text-left px-4 py-3">Joined</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.address} className="border-t border-gray-100">
              <td className="px-4 py-3 font-mono text-gray-700">
                {shortenAddress(m.address)}
              </td>
              <td className="px-4 py-3 text-gray-700">
                {m.displayName ?? "—"}
              </td>
              <td className="px-4 py-3 text-right text-gray-900">
                ${formatAmount(m.totalContributed)}
              </td>
              <td className="px-4 py-3 text-gray-500">
                {format(new Date(m.joinedAt), "MMM d, yyyy")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContributionsTab({
  contributions,
  isLoading,
}: {
  contributions: Contribution[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <div className="h-40 bg-gray-100 animate-pulse rounded-xl" />;
  }
  if (contributions.length === 0) {
    return <EmptyState message="No contributions recorded." />;
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-3">Member</th>
            <th className="text-right px-4 py-3">Amount</th>
            <th className="text-left px-4 py-3">Period</th>
            <th className="text-left px-4 py-3">Tx Hash</th>
          </tr>
        </thead>
        <tbody>
          {contributions.map((c) => (
            <tr key={c.id} className="border-t border-gray-100">
              <td className="px-4 py-3 font-mono text-gray-700">
                {shortenAddress(c.member)}
              </td>
              <td className="px-4 py-3 text-right text-gray-900">
                ${formatAmount(c.amount)}
              </td>
              <td className="px-4 py-3 text-gray-500">#{c.period}</td>
              <td className="px-4 py-3">
                <a
                  href={`${EXPLORER_BASE}/tx/${c.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-brand-600 hover:text-brand-700"
                >
                  {c.txHash.slice(0, 8)}…
                  <ExternalLink className="w-3 h-3" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoansTab({ loans, isLoading }: { loans: Loan[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-28 bg-gray-100 animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }
  if (loans.length === 0) {
    return <EmptyState message="No loans for this group." />;
  }
  return (
    <div className="space-y-3">
      {loans.map((loan) => (
        <LoanCard key={loan.id} loan={loan} />
      ))}
    </div>
  );
}

function GovernanceTab({
  proposals,
  isLoading,
}: {
  proposals: Proposal[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-32 bg-gray-100 animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }
  if (proposals.length === 0) {
    return <EmptyState message="No proposals yet." />;
  }
  return (
    <div className="space-y-3">
      {proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center py-12 text-gray-400 gap-2 bg-white rounded-xl border border-gray-200">
      <AlertCircle className="w-7 h-7" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
