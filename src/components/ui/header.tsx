"use client";

import { WalletButton } from "@/components/ui/wallet-button";

export function Header() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-end gap-4 border-b border-gray-200 bg-white/80 backdrop-blur px-6 py-3">
      <WalletButton />
    </header>
  );
}
