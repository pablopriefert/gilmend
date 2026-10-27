import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Damage Desk", template: "%s · Damage Desk" },
  description:
    "The agent that recovers the money from damaged parcels: investigates, decides, files the carrier claim, and waits for one click.",
};

// The header reads the server environment (is a model key set?). Without this the layout
// would be prerendered at build time and the label would freeze at whatever the build saw.
export const dynamic = "force-dynamic";

// System font stack on purpose: no build-time font download, so `npm run build` works
// offline and in CI.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only rounded-md bg-accent px-3 py-2 text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          Skip to content
        </a>
        <AppHeader />
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
          {children}
        </main>
        <footer className="border-t border-border bg-surface">
          <p className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-muted sm:px-6">
            Fictitious orders and customers only. Damage Desk never sends anything to a carrier or a
            customer: every message waits for a human click, and even then it is only marked ready to send.
          </p>
        </footer>
      </body>
    </html>
  );
}
