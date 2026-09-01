(() => {
  if (window.__e2bGitHubStarsCache) return;
  window.__e2bGitHubStarsCache = true;

  const storageKey = "e2b:github-stars:v1";
  const repositoryHref = "https://github.com/e2b-dev/e2b";
  const countPattern = /^\d{1,3}(?:,\d{3})*$/;

  const formatCount = (count) =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Number(count.replaceAll(",", "")));

  const setDisplayCount = (count) => {
    document.documentElement.style.setProperty(
      "--e2b-github-stars",
      JSON.stringify(formatCount(count))
    );
  };

  const readCachedCount = () => {
    try {
      const cached = JSON.parse(localStorage.getItem(storageKey) || "null");
      return countPattern.test(cached?.count || "") ? cached.count : null;
    } catch {
      return null;
    }
  };

  const writeCachedCount = (count) => {
    try {
      const cached = readCachedCount();

      if (cached !== count) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ count, updatedAt: Date.now() })
        );
      }
    } catch {
      // Keep the GitHub link functional when browser storage is unavailable.
    }
  };

  const captureLiveCount = () => {
    const repository = document.querySelector(
      `nav[aria-label="Main"] a[href="${repositoryHref}"]`
    );
    const count = repository
      ?.querySelector(":scope > div > div:nth-child(2) span")
      ?.textContent?.trim();

    if (!countPattern.test(count || "")) return;

    setDisplayCount(count);
    writeCachedCount(count);
  };

  const cachedCount = readCachedCount();
  if (cachedCount) setDisplayCount(cachedCount);

  const start = () => {
    new MutationObserver(captureLiveCount).observe(document.body, {
      childList: true,
      subtree: true,
    });

    captureLiveCount();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
