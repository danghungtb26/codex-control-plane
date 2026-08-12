import { useEffect, useState } from "react";

const DRAWER_CLASS = "tasks-drawer-open";
const DESKTOP_MEDIA = "(min-width: 768px)";

export const MobileNavigation = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle(DRAWER_CLASS, open);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    const handleTaskSelection = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("main > aside button")) setOpen(false);
    };

    const desktop = window.matchMedia(DESKTOP_MEDIA);
    const handleBreakpoint = () => {
      if (desktop.matches) setOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("click", handleTaskSelection);
    desktop.addEventListener("change", handleBreakpoint);

    return () => {
      root.classList.remove(DRAWER_CLASS);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("click", handleTaskSelection);
      desktop.removeEventListener("change", handleBreakpoint);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="mobile-nav-trigger"
        onClick={() => setOpen(true)}
        aria-label="Open tasks"
        aria-expanded={open}
      >
        <span />
        <span />
        <span />
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="mobile-nav-backdrop"
            onClick={() => setOpen(false)}
            aria-label="Close tasks"
          />
          <button
            type="button"
            className="mobile-nav-close"
            onClick={() => setOpen(false)}
            aria-label="Close tasks drawer"
          >
            ×
          </button>
        </>
      ) : null}
    </>
  );
};
