chrome.runtime.onInstalled.addListener(async function () {
  // Enable side panel for all sites
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Error setting panel behavior:", error));

  // Set default settings if not already configured
  try {
    const result = await chrome.storage.sync.get([
      "elasticUrl",
      "gitlabUrl",
      "jenkinsUrl",
      "namingPattern",
      "configServiceUrl",
      "elasticSearchServiceUrl",
      "environment",
    ]);

    // Set defaults only if not already configured
    const defaults = {};
    if (!result.elasticUrl) defaults.elasticUrl = "";
    if (!result.gitlabUrl) defaults.gitlabUrl = "";
    if (!result.jenkinsUrl) defaults.jenkinsUrl = "";
    if (!result.namingPattern) defaults.namingPattern = "";
    if (!result.configServiceUrl) defaults.configServiceUrl = "";
    if (!result.elasticSearchServiceUrl) defaults.elasticSearchServiceUrl = "";
    if (!result.environment) defaults.environment = "DEV";

    if (Object.keys(defaults).length > 0) {
      await chrome.storage.sync.set(defaults);
    }
  } catch (error) {
    console.error("Error setting up default settings:", error);
  }
});

// Listen for tab updates to refresh sidebar if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process when the page is completely loaded
  if (changeInfo.status === "complete" && tab.url) {
    // Send message to sidebar to refresh (if it's open)
    chrome.runtime
      .sendMessage({
        type: "TAB_UPDATED",
        tabId: tabId,
        url: tab.url,
      })
      .catch(() => {
        // Ignore errors if sidebar isn't open
      });
  }
});

// Listen for tab activation changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    chrome.runtime
      .sendMessage({
        type: "TAB_ACTIVATED",
        tabId: activeInfo.tabId,
        url: tab.url,
      })
      .catch(() => {
        // Ignore errors if sidebar isn't open
      });
  } catch (error) {
    // Ignore errors
  }
});

// Handle messages from content scripts or sidebar
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "GET_CURRENT_TAB":
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendResponse(tabs[0] || null);
      });
      return true; // Keep message channel open for async response

    case "OPEN_URL":
      if (message.url) {
        chrome.tabs.create({ url: message.url });
      }
      break;

    default:
      break;
  }
});

// Context menu for quick access (optional)
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "openStackSync") {
    // This will trigger the side panel to open
    chrome.action.openPopup();
  }
});

// Create context menu item on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "openStackSync",
    title: "Open StackSync Sidebar",
    contexts: ["page"],
  });
});
