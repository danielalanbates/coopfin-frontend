"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, LogOut, Wallet } from "lucide-react";
import { clsx } from "clsx";
import { useWallet } from "@/hooks/use-wallet";

const STELLAR_EXPLORER_BASE = "https://stellar.expert/explorer/testnet/account";

function shortenAddress(address: string): string {
  if (address.length <= 9) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, isConnecting, error, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; silently ignore
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setOpen(false);
  };

  // Connecting state
  if (isConnecting) {
    return (
      <button
        type="button"
        disabled
        aria-busy="true"
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white opacity-80 cursor-wait"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Connecting...
      </button>
    );
  }

  // Disconnected state
  if (!address) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={connect}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          <Wallet className="w-4 h-4" />
          Connect Wallet
        </button>
        {error && (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  // Connected state
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
      >
        <span
          className="w-2 h-2 rounded-full bg-green-500"
          aria-label="connected"
        />
        <span className="font-mono">{shortenAddress(address)}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 rounded-lg border border-gray-200 bg-white shadow-lg z-50 p-2"
        >
          <div className="px-2 py-2">
            <p className="text-xs text-gray-400 mb-1">Connected address</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-gray-800 break-all">
                {address}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy address"
                className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div className="my-1 h-px bg-gray-100" />

          <a
            href={`${STELLAR_EXPLORER_BASE}/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-2 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-50"
          >
            <ExternalLink className="w-4 h-4 text-gray-400" />
            View on Stellar Explorer
          </a>

          <button
            type="button"
            onClick={handleDisconnect}
            className={clsx(
              "flex w-full items-center gap-2 px-2 py-2 text-sm rounded-md",
              "text-red-600 hover:bg-red-50"
            )}
          >
            <LogOut className="w-4 h-4" />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
