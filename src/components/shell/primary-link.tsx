import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

// The primary action of a screen: a link dressed like the 21st.dev Shimmer Button
// (src/components/ui/shimmer-button.tsx, Magic UI / dillionverma). That component is a <button>;
// a navigation has to be an <a>, so the same layers are rebuilt here on a Next <Link>: an ink
// pill whose rim is swept by a slow gold glint. Gold because this is the one action that
// leads to recovered money (docs/design.md, principle 1). The glint is hidden under
// prefers-reduced-motion; the button stays just as legible without it.

type PrimaryLinkProps = Omit<ComponentProps<typeof Link>, "children" | "style"> & {
  children: ReactNode;
  /** `lg` for the hero or an empty state, `md` for the header. Both keep a 44 px touch target. */
  size?: "md" | "lg";
  icon?: ReactNode;
};

export function PrimaryLink({ children, className, size = "md", icon, ...props }: PrimaryLinkProps) {
  return (
    <Link
      {...props}
      style={
        {
          "--spread": "90deg",
          "--shimmer-color": "var(--gold-bright)",
          "--speed": "3.5s",
          "--cut": "0.06em",
          "--bg": "var(--ink)",
        } as CSSProperties
      }
      className={cn(
        "group relative z-0 inline-flex cursor-pointer items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-xl border border-white/10 font-semibold text-white [background:var(--bg)]",
        "transform-gpu shadow-card transition-[transform,box-shadow] duration-200 ease-out hover:shadow-raised active:translate-y-px",
        "focus-visible:outline-offset-4",
        size === "lg" ? "h-12 px-7 text-[15px]" : "h-11 px-5 text-sm",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-30 overflow-visible blur-[2px] [container-type:size] motion-reduce:hidden"
      >
        <span className="absolute inset-0 h-[100cqh] animate-shimmer-slide [aspect-ratio:1]">
          <span className="animate-spin-around absolute -inset-full w-auto rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))] [translate:0_0]" />
        </span>
      </span>
      {icon}
      {children}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-xl shadow-[inset_0_-8px_10px_#ffffff1f] transition-shadow duration-300 ease-in-out group-hover:shadow-[inset_0_-6px_10px_#ffffff3f]"
      />
      <span aria-hidden="true" className="absolute -z-20 rounded-xl [background:var(--bg)] [inset:var(--cut)]" />
    </Link>
  );
}
