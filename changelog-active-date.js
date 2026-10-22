(() => {
  if (window.__e2bChangelogActiveDate) return;
  window.__e2bChangelogActiveDate = true;

  // The entry being read is the last one whose date column has reached its sticky spot under the header; before the
  // first one gets there, the first entry is the one being read. Its date turns orange (style.css), the rest stay grey.
  const attribute = "data-e2b-active";
  let frame = 0;

  const update = () => {
    frame = 0;
    const entries = document.querySelectorAll(".update-container");
    if (!entries.length) return;

    const rail = entries[0].firstElementChild;
    const stickyTop = rail ? parseFloat(getComputedStyle(rail).top) || 0 : 0;
    let active = entries[0];

    for (const entry of entries) {
      const top = (entry.firstElementChild || entry).getBoundingClientRect().top;
      if (top > stickyTop + 1) break;
      active = entry;
    }

    for (const entry of entries) {
      entry.toggleAttribute(attribute, entry === active);
    }
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  const start = () => {
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    // Client-side navigation and the tag filters replace the entries.
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
    });
    schedule();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
