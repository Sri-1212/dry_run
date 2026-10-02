/**
 * Monaco Bridge Script (Runs in the MAIN world context of leetcode.com)
 * Allows extraction of code directly from Monaco Editor instances.
 */

(function () {
  'use strict';

  function extractMonacoCode() {
    try {
      // Strategy 1: Directly query window.monaco editor instances
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          // Find model containing C++ code or primary model
          const cppModel = models.find(m => m.getLanguageId() === 'cpp' || m.getLanguageId() === 'cpp20') || models[0];
          if (cppModel && cppModel.getValue()) {
            return cppModel.getValue();
          }
        }
      }

      // Strategy 2: Query active Monaco Editor instances attached to DOM
      if (window.monaco && window.monaco.editor && window.monaco.editor.getEditors) {
        const editors = window.monaco.editor.getEditors();
        for (const ed of editors) {
          const val = ed.getValue();
          if (val && val.trim().length > 0) {
            return val;
          }
        }
      }
    } catch (e) {
      console.warn('[DryRun Monaco Bridge] Error accessing window.monaco:', e);
    }
    return null;
  }

  // Listen for requests from content script
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'DRY_RUN_REQUEST_MONACO_CODE') {
      const code = extractMonacoCode();
      window.postMessage({
        type: 'DRY_RUN_MONACO_CODE_RESPONSE',
        code: code,
        success: !!code
      }, '*');
    }
  });

  // Periodically check or observe Monaco editor ready state
  let attempts = 0;
  const pollInterval = setInterval(() => {
    attempts++;
    const code = extractMonacoCode();
    if (code || attempts > 10) {
      clearInterval(pollInterval);
      if (code) {
        window.postMessage({
          type: 'DRY_RUN_MONACO_CODE_READY',
          code: code
        }, '*');
      }
    }
  }, 1000);
})();
