/**
 * Chrome DevTools Integration Script
 * Registers a "Dry Run C++" panel inside Chrome Developer Tools.
 */

if (typeof chrome !== 'undefined' && chrome.devtools) {
  chrome.devtools.panels.create(
    "Dry Run C++ 🐉",
    "../icons/icon16.png",
    "../popup/popup.html",
    (panel) => {
      console.log("[DryRun DevTools] Dry Run C++ DevTools Panel created successfully.");
    }
  );
}
