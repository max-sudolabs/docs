(() => {
  if (window.__e2bSidebarStatePersistence) return;
  window.__e2bSidebarStatePersistence = true;

  const storageKey = "e2b:sidebar-groups:v1";

  const readState = () => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || "{}");
    } catch {
      return {};
    }
  };

  const writeState = (state) => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Keep navigation functional when browser storage is unavailable.
    }
  };

  const groupKey = (button) => {
    const path = [];
    const activeTab =
      document.querySelector(".nav-tabs-item[data-active]")?.textContent.trim() ||
      "default";
    let item = button.closest("li[data-title]");

    while (item) {
      path.unshift(item.dataset.title);
      item = item.parentElement?.closest("li[data-title]");
    }

    return [activeTab, ...path].join(" > ");
  };

  const restoreState = () => {
    const state = readState();

    document
      .querySelectorAll('#sidebar li[data-title] > button[aria-expanded]')
      .forEach((button) => {
        const saved = state[groupKey(button)];
        const expanded = button.getAttribute("aria-expanded") === "true";

        if (typeof saved === "boolean" && saved !== expanded) {
          button.click();
        }
      });
  };

  const start = () => {
    document.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest(
          '#sidebar li[data-title] > button[aria-expanded]'
        );

        if (!button) return;

        const state = readState();
        state[groupKey(button)] =
          button.getAttribute("aria-expanded") !== "true";
        writeState(state);
      },
      true
    );

    new MutationObserver(restoreState).observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-expanded", "data-active"],
      childList: true,
      subtree: true,
    });

    restoreState();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
