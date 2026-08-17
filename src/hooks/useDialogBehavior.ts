/**
 * Shared dialog behaviour: Escape to close, focus trapping, focus
 * restoration, and keyboard-aware sizing on mobile.
 *
 * Dialogs previously closed only by backdrop tap, never trapped or
 * restored focus, and — being bottom-anchored sheets — put their primary
 * button exactly where the iOS keyboard appears.
 */
import { useEffect, useRef, useState } from "react";

export function useDialogBehavior(onClose: () => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Height of the on-screen keyboard, so the sheet can sit above it. */
  const [keyboardInset, setKeyboardInset] = useState(0);

  // Escape closes; Tab cycles within the dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const enabled = Array.from(focusable).filter((el) => !el.hasAttribute("disabled"));
      if (enabled.length === 0) return;
      const first = enabled[0];
      const last = enabled[enabled.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Focus the dialog on open, restore the previous focus on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = containerRef.current;
    const target = root?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([aria-label="Dismiss"])',
    );
    target?.focus();
    return () => previous?.focus?.();
  }, []);

  // Track the visual viewport so the sheet stays above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return { containerRef, keyboardInset };
}
