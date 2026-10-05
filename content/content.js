/**
 * Content Script for Dry Run Chrome Extension
 * Runs on leetcode.com/problems/* pages.
 * 
 * ARCHITECTURE OVERVIEW:
 * 1. Inject `monaco_bridge.js` into MAIN world to access window.monaco APIs directly.
 * 2. Fallback DOM extraction for LeetCode's Monaco Editor elements (.view-lines).
 * 3. Communicate with Popup and Background Service Worker via Chrome extension runtime messaging.
 * 4. Inject floating floating widget/sidebar into LeetCode DOM for seamless dry run interaction.
 */

(function () {
  'use strict';

  let latestExtractedCode = '';
  let inPagePanelVisible = false;
  let lineDecorations = [];

  // Inject Monaco bridge script into DOM
  function injectMonacoBridge() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/monaco_bridge.js');
      script.onload = function () {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn('[DryRun Content] Could not inject monaco bridge:', e);
    }
  }

  // Listen for Monaco bridge responses from window.postMessage
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'DRY_RUN_MONACO_CODE_RESPONSE') {
      if (event.data.code) {
        latestExtractedCode = event.data.code;
      }
    } else if (event.data && event.data.type === 'DRY_RUN_MONACO_CODE_READY') {
      latestExtractedCode = event.data.code;
    }
  });

  /**
   * Primary method to extract C++ solution code from LeetCode page:
   * Strategy A: Request from window.monaco bridge
   * Strategy B: Extract text content from Monaco Editor DOM lines (.view-lines)
   * Strategy C: Extract from textarea fallback
   */
  async function getCodeFromLeetCode() {
    // Strategy A: Post message to Monaco bridge and wait briefly
    window.postMessage({ type: 'DRY_RUN_REQUEST_MONACO_CODE' }, '*');
    await new Promise(r => setTimeout(r, 150));

    if (latestExtractedCode && latestExtractedCode.trim().length > 0) {
      return latestExtractedCode;
    }

    // Strategy B: DOM extraction from .monaco-editor .view-line
    const lineElements = document.querySelectorAll('.monaco-editor .view-line');
    if (lineElements && lineElements.length > 0) {
      const lines = Array.from(lineElements).map(el => el.textContent || '');
      const domCode = lines.join('\n');
      if (domCode.trim().length > 0) {
        return domCode;
      }
    }

    // Strategy C: Check textarea
    const textareas = document.querySelectorAll('.monaco-editor textarea');
    for (const ta of textareas) {
      if (ta.value && ta.value.trim().length > 0) {
        return ta.value;
      }
    }

    return '';
  }

  /**
   * Helper to extract problem details from URL and document metadata
   */
  function getProblemMetadata() {
    const url = window.location.href;
    const match = url.match(/\/problems\/([^\/]+)/);
    const slug = match ? match[1] : 'leetcode-problem';
    
    // Attempt to extract title from DOM header
    const titleEl = document.querySelector('[data-cy="question-title"]') || document.querySelector('.text-title-large');
    const title = titleEl ? titleEl.textContent.trim() : slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    return { slug, title, url };
  }

  /**
   * Dynamically extracts example test cases from the active LeetCode problem page DOM
   */
  function extractExamplesFromDOM() {
    const examples = [];
    const container = 
      document.querySelector('[data-track-load="description_content"]') ||
      document.querySelector('.elfjS') ||
      document.querySelector('div[class*="content__"]') ||
      document.querySelector('div[class*="description"]') ||
      document.body;

    if (!container) return examples;

    // Strategy 1: Look for <pre> tags containing Input: ...
    const preElements = container.querySelectorAll('pre');
    preElements.forEach((pre) => {
      const text = pre.innerText || pre.textContent || '';
      if (/input\s*:/i.test(text)) {
        const inputVal = extractInputText(text);
        if (inputVal && !examples.some(e => e.input === inputVal)) {
          examples.push({
            id: examples.length + 1,
            label: `Example ${examples.length + 1}`,
            input: inputVal
          });
        }
      }
    });

    // Strategy 2: Look for example blocks / elements with Input: ...
    if (examples.length === 0) {
      const blocks = container.querySelectorAll('div, section, p, li');
      blocks.forEach((block) => {
        const text = block.innerText || block.textContent || '';
        if (/^input\s*:/i.test(text.trim()) || (text.includes('Input:') && text.includes('Output:'))) {
          if (block.querySelectorAll('pre').length === 0 && text.length < 600) {
            const inputVal = extractInputText(text);
            if (inputVal && !examples.some(e => e.input === inputVal)) {
              examples.push({
                id: examples.length + 1,
                label: `Example ${examples.length + 1}`,
                input: inputVal
              });
            }
          }
        }
      });
    }

    // Strategy 3: Check window.__NEXT_DATA__
    if (examples.length === 0 && window.__NEXT_DATA__) {
      try {
        const queries = window.__NEXT_DATA__?.props?.pageProps?.dehydratedState?.queries || [];
        for (const q of queries) {
          const question = q?.state?.data?.question;
          if (question && question.exampleTestcaseList && Array.isArray(question.exampleTestcaseList)) {
            question.exampleTestcaseList.forEach((tc, idx) => {
              if (tc && tc.trim()) {
                examples.push({
                  id: idx + 1,
                  label: `Example ${idx + 1}`,
                  input: tc.trim()
                });
              }
            });
            break;
          }
        }
      } catch (e) {}
    }

    return examples;
  }

  function extractInputText(text) {
    if (!text) return '';
    const match = text.match(/input\s*:\s*([\s\S]*?)(?=(?:output\s*:|explanation\s*:|example\s+\d+|$))/i);
    if (match && match[1]) {
      let clean = match[1].trim();
      clean = clean.replace(/^`+|`+$/g, '').trim();
      return clean;
    }
    return '';
  }

  /**
   * Create and inject floating dragon widget on LeetCode page
   */
  function injectFloatingWidget() {
    if (document.getElementById('dryrun-dragon-badge')) return;

    const badge = document.createElement('button');
    badge.id = 'dryrun-dragon-badge';
    badge.title = 'Open Dry Run C++ Visualizer';
    badge.innerHTML = `
      <span class="dragon-icon">🐉</span>
      <span class="badge-text">Dry Run</span>
    `;

    badge.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'OPEN_POPUP_OR_TOGGLE' });
      toggleInPageSidePanel();
    });

    document.body.appendChild(badge);
  }

  /**
   * In-page collapsible floating side panel for quick dry running without closing popup
   */
  function toggleInPageSidePanel() {
    let panel = document.getElementById('dryrun-inpage-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'dryrun-inpage-panel';
      panel.innerHTML = `
        <div class="dryrun-panel-header">
          <div class="dryrun-title">🐉 Dry Run C++</div>
          <button class="dryrun-close-btn" id="dryrun-close-panel">✕</button>
        </div>
        <div class="dryrun-panel-body">
          <div class="dryrun-status">Extension Ready! Click the extension icon in Chrome toolbar for full step-by-step interactive visualizer.</div>
          <button class="dryrun-action-btn" id="dryrun-quick-extract">📋 Read Monaco C++ Code</button>
          <pre id="dryrun-code-preview" class="dryrun-preview-box">Loading editor code...</pre>
        </div>
      `;
      document.body.appendChild(panel);

      document.getElementById('dryrun-close-panel').addEventListener('click', () => {
        panel.style.display = 'none';
        inPagePanelVisible = false;
      });

      document.getElementById('dryrun-quick-extract').addEventListener('click', async () => {
        const code = await getCodeFromLeetCode();
        const box = document.getElementById('dryrun-code-preview');
        if (box) box.textContent = code;
      });
    }

    inPagePanelVisible = !inPagePanelVisible;
    panel.style.display = inPagePanelVisible ? 'flex' : 'none';

    if (inPagePanelVisible) {
      getCodeFromLeetCode().then(code => {
        const box = document.getElementById('dryrun-code-preview');
        if (box) box.textContent = code;
      });
    }
  }

  /**
   * Listen for chrome runtime messages from extension Popup / Service Worker
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_LEETCODE_CODE') {
      getCodeFromLeetCode().then(code => {
        const metadata = getProblemMetadata();
        const examples = extractExamplesFromDOM();
        sendResponse({
          success: !!code,
          code: code,
          slug: metadata.slug,
          title: metadata.title,
          url: metadata.url,
          examples: examples
        });
      });
      return true; // Keep channel open for async response
    }

    if (request.action === 'HIGHLIGHT_LINE') {
      const lineNum = request.lineNumber;
      highlightMonacoLine(lineNum);
      sendResponse({ success: true });
    }
  });

  /**
   * Highlight line inside DOM element of Monaco Editor if available
   */
  function highlightMonacoLine(lineNum) {
    const lines = document.querySelectorAll('.monaco-editor .view-line');
    lines.forEach((line, idx) => {
      if (idx + 1 === lineNum) {
        line.classList.add('dryrun-active-line');
        line.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        line.classList.remove('dryrun-active-line');
      }
    });
  }

  // Initialize on page load
  injectMonacoBridge();
  setTimeout(injectFloatingWidget, 1500);
})();
