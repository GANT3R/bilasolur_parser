const STORAGE_DEFAULTS = { enabled: true };
const BILASOLUR_URL_FILTER = "https://bilasolur.is/*";

async function readEnabledFlag() {
  const { enabled } = await chrome.storage.local.get(STORAGE_DEFAULTS);
  return Boolean(enabled);
}

async function writeEnabledFlag(enabled) {
  await chrome.storage.local.set({ enabled: Boolean(enabled) });
}

async function setActionBadge(isEnabled) {
  await chrome.action.setBadgeText({ text: isEnabled ? "on" : "" });
  await chrome.action.setBadgeBackgroundColor({
    color: isEnabled ? "#22c55e" : "#6b7280"
  });
}

async function notifyAllBilasolurTabs(isEnabled) {
  const tabs = await chrome.tabs.query({ url: BILASOLUR_URL_FILTER });
  await Promise.all(
    tabs
      .filter((t) => typeof t.id === "number")
      .map((t) =>
        chrome.tabs.sendMessage(t.id, { type: "BILASOLUR_SET_ENABLED", enabled: isEnabled }).catch(() => {})
      )
  );
}

async function syncBadgeFromStorage() {
  const isEnabled = await readEnabledFlag();
  await setActionBadge(isEnabled);
}

chrome.runtime.onInstalled.addListener(syncBadgeFromStorage);
chrome.runtime.onStartup.addListener(syncBadgeFromStorage);

chrome.action.onClicked.addListener(async () => {
  const current = await readEnabledFlag();
  const next = !current;

  await writeEnabledFlag(next);
  await setActionBadge(next);
  await notifyAllBilasolurTabs(next);
});