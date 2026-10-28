import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "@/components/app-header";
import { SiteFooter } from "@/components/shell/site-footer";
import { hasOpenRouterKey, openRouterModel, resolveOpenWeights } from "@/lib/config";
import "./globals.css";

// One family everywhere, Geist (Pablo's choice, 27 Oct 2026): headings and money figures are the
// same face in semibold with tight tracking (see .font-display in globals.css), references in
// Geist Mono. Self-hosted by next/font at build time: no request to Google from the browser.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const DESCRIPTION =
  "The agent that prepares the claim to recover the money from damaged parcels: investigates, decides, prepares the carrier claim, and waits for one click.";

export const metadata: Metadata = {
  // The link preview (src/app/opengraph-image.tsx, twitter-image.tsx) needs an absolute URL. Without
  // metadataBase Next guesses one from the Vercel environment, which on this project can be the
  // internal deployment name instead of the public address. Preview deployments therefore point at
  // the public address too (a preview's own card is not worth a second source of truth).
  metadataBase: new URL("https://gilmend.vercel.app"),
  title: { default: "Gilmend · Broken parcels, mended in gold", template: "%s · Gilmend" },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Gilmend",
    title: "Gilmend · Broken parcels, mended in gold",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Gilmend · Broken parcels, mended in gold",
    description: DESCRIPTION,
  },
};

// The header reads the server environment (is a model key set?). Without this the layout
// would be prerendered at build time and the label would freeze at whatever the build saw.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The Muse Model License asks every product that uses Muse Spark Open to say so in its UI.
  // The OpenRouter test engine can serve it too (OPENROUTER_MODEL=meta/muse-spark-open).
  const builtWithSparkOpen =
    /muse-spark-open/i.test(resolveOpenWeights()?.model ?? "") ||
    (hasOpenRouterKey() && /muse-spark-open/i.test(openRouterModel()));
  return (
    <html
      lang="en"
      className={`h-full antialiased ${geist.variable} ${geistMono.variable}`}
    >
      <body className="paper flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-raised focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          Skip to content
        </a>
        <AppHeader />
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
          {children}
        </main>
        <SiteFooter builtWithSparkOpen={builtWithSparkOpen} />
      </body>
    </html>
  );
}
