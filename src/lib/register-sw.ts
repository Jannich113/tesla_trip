/** Register the PWA service worker once the app is on a real origin. */

const PERIODIC_TAG = "juniper-prices";
const PERIODIC_MS = 12 * 60 * 60 * 1000;

type PeriodicSyncManager = {
  register: (tag: string, options?: { minInterval: number }) => Promise<void>;
  getTags: () => Promise<string[]>;
};

function periodicSyncOf(reg: ServiceWorkerRegistration) {
  return (reg as ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }).periodicSync;
}

async function registerPeriodicPrices(reg: ServiceWorkerRegistration) {
  const periodic = periodicSyncOf(reg);
  if (!periodic) return;
  try {
    const status = await navigator.permissions.query({
      name: "periodic-background-sync" as PermissionName,
    });
    if (status.state === "denied") return;
    const tags = await periodic.getTags();
    if (tags.includes(PERIODIC_TAG)) return;
    await periodic.register(PERIODIC_TAG, { minInterval: PERIODIC_MS });
  } catch {
    /* not installed, iOS, or permission missing */
  }
}

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) return;

  void navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((reg) => {
      void reg.update();
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
      void navigator.serviceWorker.ready.then((ready) => registerPeriodicPrices(ready));
    })
    .catch(() => {
      /* private mode / insecure origin */
    });
}