"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import Toast from "@/components/arc/toast/toast";

// Result feedback for the case page (Arc toast): approved, rejected, saved, copied. The toast is
// only a courtesy that fades after a few seconds; the lasting state (status, errors) is always
// written in the page itself, so nothing depends on a message that disappears.

interface ToastMessage {
  title: string;
  description?: string;
}

const ToastContext = createContext<(message: ToastMessage) => void>(() => {});

/** Raise a toast. Outside a CaseToastHost it does nothing. */
export function useCaseToast(): (message: ToastMessage) => void {
  return useContext(ToastContext);
}

export function CaseToastHost({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage & { open: boolean }>({ title: "", open: false });
  const notify = useCallback((message: ToastMessage) => setToast({ ...message, open: true }), []);
  const onOpenChange = useCallback((open: boolean) => setToast((t) => ({ ...t, open })), []);
  const value = useMemo(() => notify, [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center sm:inset-x-6 sm:justify-end">
        <div className="pointer-events-auto flex w-full max-w-[26rem] justify-center sm:justify-end">
          <Toast title={toast.title} description={toast.description} open={toast.open} onOpenChange={onOpenChange} />
        </div>
      </div>
    </ToastContext.Provider>
  );
}
