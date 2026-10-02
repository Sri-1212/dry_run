/**
 * Background Service Worker (Manifest V3)
 * Manages extension state, tab tracking, and background API proxying.
 */

// Listener for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[DryRun Service Worker] Extension installed successfully.');
    // Initialize default settings in storage
    chrome.storage.sync.set({
      theme: 'dark-dragon',
      apiProvider: 'interpreter',
      stepSpeedMs: 800,
      autoTrace: true
    });
  }
});

// Listener for message routing across extension components
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[DryRun Service Worker] Received message:', message.action);

  if (message.action === 'GET_ACTIVE_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        sendResponse({ tab: tabs[0] });
      } else {
        sendResponse({ tab: null });
      }
    });
    return true;
  }

  if (message.action === 'PROXY_LLM_REQUEST') {
    // Background proxy for API calls if required
    fetch(message.url, message.options)
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
