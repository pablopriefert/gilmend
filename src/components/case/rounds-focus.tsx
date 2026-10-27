"use client";

import { useEffect } from "react";

// After a customer's reply is processed, the "The customer replied" card is usually gone (the decision
// is no longer "ask for more photos") and the button that had the focus with it: keyboard and screen
// reader focus fell back to <body>, and only a toast said anything (review of 28 Oct 2026). The panel
// calls requestRoundsFocus() just before it asks for the new page; the "Rounds of this case" card
// reads the request when it appears (or when it gains a round) and moves the focus to its title. The
// request lives in memory, not in the URL: it must survive router.refresh() and the navigation to a
// forked case, and it must not outlive the page.

// The request expires: if the visitor leaves before the new page arrives, a card of another case that
// shows up minutes later must not steal their focus.
const REQUEST_LIFETIME_MS = 15_000;
let expiresAt = 0;

export function requestRoundsFocus(): void {
  expiresAt = Date.now() + REQUEST_LIFETIME_MS;
}

/** Tests: forget a request that no card consumed. */
export function clearRoundsFocusRequest(): void {
  expiresAt = 0;
}

export function RoundsFocus({ titleId, roundCount }: { titleId: string; roundCount: number }) {
  useEffect(() => {
    if (Date.now() >= expiresAt) return;
    expiresAt = 0;
    document.getElementById(titleId)?.focus();
  }, [titleId, roundCount]);
  return null;
}
