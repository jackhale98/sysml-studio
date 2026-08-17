/**
 * Viewport class, so the desktop build can use the space it has.
 *
 * The app shipped one layout — a phone shell with a bottom tab bar —
 * into a 1280x800 desktop window, showing a single panel at a time.
 */
import { useEffect, useState } from "react";

export type ViewportClass = "compact" | "wide";

/** `wide` at >= 900px, where a side-by-side layout fits comfortably. */
export function useViewport(): ViewportClass {
  const [cls, setCls] = useState<ViewportClass>(() =>
    typeof window !== "undefined" && window.innerWidth >= 900 ? "wide" : "compact",
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const update = () => setCls(mq.matches ? "wide" : "compact");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return cls;
}
