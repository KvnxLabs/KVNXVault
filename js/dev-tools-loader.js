"use strict";

// Production loads only this inert gate. The development repository, panel,
// and stylesheet are requested only after an exact-host frontend opt-in. The
// database performs its own independent environment and account checks.
(function initializeDevToolsLoader(root, factory) {
  const loader = factory();

  if (typeof module === "object" && module.exports) module.exports = loader;
  if (root) root.KVNXDevToolsLoader = loader;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const BLOCKED_PRODUCTION_HOSTS = Object.freeze([
    "kvnxlabs.com",
    "www.kvnxlabs.com",
    "kvnx-vault.vercel.app",
  ]);

  const normalizeHostname = (hostname) => String(hostname || "").trim().toLowerCase();

  const canActivateDevTools = (config = {}, hostname = "") => {
    const normalizedHostname = normalizeHostname(hostname);
    const allowedHosts = Array.isArray(config.devToolsAllowedHosts)
      ? config.devToolsAllowedHosts.map(normalizeHostname)
      : [];

    return config.devToolsEnabled === true
      && normalizedHostname.length > 0
      && !BLOCKED_PRODUCTION_HOSTS.includes(normalizedHostname)
      && allowedHosts.includes(normalizedHostname);
  };

  const loadScript = (documentRef, source) => new Promise((resolve, reject) => {
    const script = documentRef.createElement("script");
    script.src = source;
    script.defer = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", reject, { once: true });
    documentRef.head.append(script);
  });

  const activate = async ({ root, documentRef, config, hostname } = {}) => {
    if (!root || !documentRef || !canActivateDevTools(config, hostname)) return false;

    const stylesheet = documentRef.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "css/dev-tools.css";
    stylesheet.dataset.devToolsAsset = "true";
    documentRef.head.append(stylesheet);

    await loadScript(documentRef, "js/dev-tools-repository.js");
    await loadScript(documentRef, "js/dev-tools.js");
    await root.KVNXDevTools?.initialize();
    return true;
  };

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
      activate({
        root: window,
        documentRef: document,
        config: window.KVNXConfig,
        hostname: window.location.hostname,
      }).catch(() => {
        // Development tooling failure must never interfere with Vault startup.
      });
    });
  }

  return Object.freeze({ BLOCKED_PRODUCTION_HOSTS, activate, canActivateDevTools });
});
