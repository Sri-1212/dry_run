/**
 * Popup Logic for Dry Run Chrome Extension
 * Direct LeetCode Monaco Editor integration using chrome.scripting.executeScript (world: MAIN)
 * and Gemini AI execution tracing via background service worker.
 */

import { StorageService } from '../utils/storage.js';
import { LeetCodeHelper } from '../utils/leetcode_api.js';

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const problemTitleEl = document.getElementById('problem-title');
  const detectedLangChip = document.getElementById('detected-lang-chip');
  const fetchCodeBtn = document.getElementById('fetch-code-btn');
  const sampleInputArea = document.getElementById('sample-input');
  const startDryRunBtn = document.getElementById('start-dryrun-btn');

  // Verification Banner Elements
  const verificationBanner = document.getElementById('verification-banner');
  const verifyLangBadge = document.getElementById('verify-lang-badge');
  const verifyLengthBadge = document.getElementById('verify-length-badge');
  const verifyCodeSnippet = document.getElementById('verify-code-snippet');
  const verifyPlayBtn = document.getElementById('verify-play-btn');

  // Manual Fallback Elements
  const manualFallbackSection = document.getElementById('manual-fallback-section');
  const manualCodeInput = document.getElementById('manual-code-input');
  const useManualCodeBtn = document.getElementById('use-manual-code-btn');

  // Dynamic Examples Selector & Input Elements
  const exampleSelectorContainer = document.getElementById('example-selector-container');
  const exampleStatusSubtext = document.getElementById('example-status-subtext');
  const clearInputBtn = document.getElementById('clear-input-btn');

  // State Containers
  const stateIdle = document.getElementById('state-idle');
  const stateLoading = document.getElementById('state-loading');
  const stateError = document.getElementById('state-error');
  const stateResult = document.getElementById('state-result');
  const loadingMessage = document.getElementById('loading-message');
  const errorMessageText = document.getElementById('error-message-text');
  const errorRetryBtn = document.getElementById('error-retry-btn');

  // Step Result Controls & Views
  const stepFirstBtn = document.getElementById('step-first');
  const stepPrevBtn = document.getElementById('step-prev');
  const stepPlayBtn = document.getElementById('step-play');
  const stepNextBtn = document.getElementById('step-next');
  const stepLastBtn = document.getElementById('step-last');
  const currentStepNumEl = document.getElementById('current-step-num');
  const totalStepsNumEl = document.getElementById('total-steps-num');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const stepSlider = document.getElementById('step-slider');
  const lineNumBadge = document.getElementById('line-num-badge');
  const stepExplanation = document.getElementById('step-explanation');
  const codeLinesBox = document.getElementById('code-lines-box');
  const activeLineIndicator = document.getElementById('active-line-indicator');
  const changedVarsBadge = document.getElementById('changed-vars-badge');
  const variableTableBody = document.getElementById('variable-table-body');
  const callStackList = document.getElementById('call-stack-list');
  const outputText = document.getElementById('output-text');
  const finalOutputCard = document.getElementById('final-output-card');
  const finalOutputText = document.getElementById('final-output-text');
  const openDevtoolsLink = document.getElementById('open-devtools-link');

  // App State Variables
  let currentSettings = {};
  let currentProblemSlug = '';
  let extractedCppCode = ''; // Full code kept internally for AI trace
  let detectedLanguage = 'C++';
  let traceSteps = [];
  let currentStepIndex = 0;
  let isPlaying = false;
  let playTimer = null;
  let finalTraceOutput = '';
  let stepSpeedMs = 800;

  // Load Saved Settings
  currentSettings = await StorageService.getSettings();
  stepSpeedMs = currentSettings.stepSpeedMs || 800;

  // Initial Read from Active LeetCode Monaco Editor & Problem Examples
  await readMonacoEditorCode();

  // --------------------------------------------------------------------------
  // CORE MONACO EDITOR & EXAMPLE READER
  // --------------------------------------------------------------------------

  async function readMonacoEditorCode() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        showError("No active tab found. Please navigate to a LeetCode problem page.");
        showManualFallback();
        return;
      }

      currentProblemSlug = LeetCodeHelper.extractProblemSlug(tab.url) || 'leetcode-problem';
      problemTitleEl.textContent = LeetCodeHelper.formatTitle(currentProblemSlug);

      if (!tab.url.includes('leetcode.com') && !tab.url.includes('leetcode.cn')) {
        showError("Please open a problem page on leetcode.com before running Dry Run.");
        showManualFallback();
        return;
      }

      // Execute script in page's MAIN world context to access active Monaco instance & DOM description
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: extractMonacoFromPage
      }).catch(err => {
        console.warn("[DryRun] Script execution error:", err);
        return null;
      });

      let detectedExamples = [];

      if (!results || !results[0] || !results[0].result) {
        const contentRes = await chrome.tabs.sendMessage(tab.id, { action: 'GET_LEETCODE_CODE' }).catch(() => null);
        if (contentRes && contentRes.code) {
          detectedExamples = contentRes.examples || [];
          const guessedLang = normalizeLanguage('', contentRes.code);
          processExtractedCode(contentRes.code, guessedLang);
        } else {
          showError("Unable to access Monaco editor automatically. Please paste your code manually below.");
          showManualFallback();
        }
      } else {
        const res = results[0].result;
        if (!res.success) {
          showError(res.error || "Failed to access Monaco editor.");
          showManualFallback();
          return;
        }

        detectedExamples = res.examples || [];
        const rawCode = res.code;
        const rawLang = res.language;

        if (!rawCode || rawCode.trim().length === 0) {
          showError("LeetCode editor is empty. Please write or paste your solution first.");
          showManualFallback();
        } else {
          const langNorm = normalizeLanguage(rawLang, rawCode);
          detectedLanguage = langNorm;
          detectedLangChip.textContent = langNorm;
          processExtractedCode(rawCode, langNorm);
        }
      }

      // Fallback: If DOM extraction yielded 0 examples, query LeetCode GraphQL API
      if (detectedExamples.length === 0 && currentProblemSlug && currentProblemSlug !== 'leetcode-problem') {
        try {
          const details = await LeetCodeHelper.fetchProblemDetails(currentProblemSlug);
          if (details && details.exampleTestcases) {
            detectedExamples = LeetCodeHelper.parseGraphQLTestcases(details.exampleTestcases);
          }
        } catch (gqlErr) {
          console.warn("[DryRun] GraphQL example fallback error:", gqlErr);
        }
      }

      // Render dynamic examples or manual fallback subtext
      await handleExtractedExamples(detectedExamples);

    } catch (err) {
      console.error("[DryRun] Monaco read error:", err);
      showError(`Monaco Access Error: ${err.message}`);
      showManualFallback();
    }
  }

  function extractMonacoFromPage() {
    try {
      let code = '';
      let lang = '';
      let methodUsed = '';

      const m = window.monaco || window.Monaco;
      if (m && m.editor) {
        // Strategy 1: Active Monaco Editor instance via monaco.editor.getEditors()
        if (m.editor.getEditors) {
          const editors = m.editor.getEditors();
          for (const ed of editors) {
            const model = typeof ed.getModel === 'function' ? ed.getModel() : null;
            if (model) {
              const val = typeof model.getValue === 'function' ? model.getValue() : '';
              if (val && val.trim().length > 0) {
                code = val;
                lang = typeof model.getLanguageId === 'function' ? model.getLanguageId() : '';
                methodUsed = 'monaco.editor.getEditors() -> model.getLanguageId() & model.getValue()';
                break;
              }
            }
          }
        }

        // Strategy 2: Active model matching C++ or non-empty value via monaco.editor.getModels()
        if (!code && m.editor.getModels) {
          const models = m.editor.getModels();
          if (models && models.length > 0) {
            let activeModel = models.find(mod => {
              if (mod && mod.isDisposed && mod.isDisposed()) return false;
              const lId = typeof mod.getLanguageId === 'function' ? mod.getLanguageId() : '';
              return lId === 'cpp' || lId === 'c++' || lId === 'cpp20';
            });

            if (!activeModel) {
              for (let i = models.length - 1; i >= 0; i--) {
                const mod = models[i];
                if (mod && (!mod.isDisposed || !mod.isDisposed())) {
                  const val = typeof mod.getValue === 'function' ? mod.getValue() : '';
                  if (val && val.trim().length > 0) {
                    activeModel = mod;
                    break;
                  }
                }
              }
            }

            if (activeModel) {
              if (typeof activeModel.getValue === 'function') {
                code = activeModel.getValue();
              }
              if (typeof activeModel.getLanguageId === 'function') {
                lang = activeModel.getLanguageId();
              }
              methodUsed = 'monaco.editor.getModels() -> model.getLanguageId() & model.getValue()';
            }
          }
        }
      }

      if (!lang) {
        const langBtn = document.querySelector('button[id*="lang"]') ||
                       document.querySelector('[data-cy="lang-select"]') ||
                       document.querySelector('.ant-select-selection-selected-value') ||
                       document.querySelector('button[class*="bg-fill-"]') ||
                       document.querySelector('[class*="lang-select"]');
        if (langBtn) {
          lang = langBtn.textContent.trim();
        }
      }

      if (!code) {
        const viewLines = document.querySelectorAll('.monaco-editor .view-line');
        if (viewLines && viewLines.length > 0) {
          code = Array.from(viewLines).map(l => l.textContent || '').join('\n');
          methodUsed = 'DOM (.monaco-editor .view-line)';
        }
      }

      // Extract DOM examples from problem description container
      const examples = [];
      try {
        const container = 
          document.querySelector('[data-track-load="description_content"]') ||
          document.querySelector('.elfjS') ||
          document.querySelector('div[class*="content__"]') ||
          document.querySelector('div[class*="description"]') ||
          document.body;

        if (container) {
          const pres = container.querySelectorAll('pre');
          pres.forEach((pre) => {
            const text = pre.innerText || pre.textContent || '';
            if (/input\s*:/i.test(text)) {
              const mMatch = text.match(/input\s*:\s*([\s\S]*?)(?=(?:output\s*:|explanation\s*:|example\s+\d+|$))/i);
              if (mMatch && mMatch[1]) {
                const clean = mMatch[1].trim().replace(/^`+|`+$/g, '').trim();
                if (clean && !examples.some(e => e.input === clean)) {
                  examples.push({
                    id: examples.length + 1,
                    label: `Example ${examples.length + 1}`,
                    input: clean
                  });
                }
              }
            }
          });

          if (examples.length === 0) {
            const blocks = container.querySelectorAll('div, section, p, li');
            blocks.forEach((block) => {
              const text = block.innerText || block.textContent || '';
              if (/^input\s*:/i.test(text.trim()) || (text.includes('Input:') && text.includes('Output:'))) {
                if (block.querySelectorAll('pre').length === 0 && text.length < 600) {
                  const mMatch = text.match(/input\s*:\s*([\s\S]*?)(?=(?:output\s*:|explanation\s*:|example\s+\d+|$))/i);
                  if (mMatch && mMatch[1]) {
                    const clean = mMatch[1].trim().replace(/^`+|`+$/g, '').trim();
                    if (clean && !examples.some(e => e.input === clean)) {
                      examples.push({
                        id: examples.length + 1,
                        label: `Example ${examples.length + 1}`,
                        input: clean
                      });
                    }
                  }
                }
              }
            });
          }

          if (examples.length === 0 && window.__NEXT_DATA__) {
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
          }
        }
      } catch (eEx) {
        console.warn('[DryRun] DOM example extraction warning:', eEx);
      }

      return {
        success: true,
        code: code || '',
        language: lang || '',
        methodUsed: methodUsed || 'None',
        examples: examples
      };
    } catch (e) {
      return { success: false, error: e.toString() };
    }
  }

  /**
   * Maps Monaco language IDs and LeetCode DOM text to canonical display names.
   * Covers every language LeetCode exposes via Monaco.
   */
  function normalizeLanguage(rawLang, code) {
    if (!rawLang) {
      // Syntax-based inference when Monaco language ID is unavailable
      if (code.includes('#include') || code.includes('using namespace std') || code.includes('vector<')) return 'C++';
      if (code.includes('def ') && code.includes(':')) return 'Python';
      if (code.includes('public class ') || code.includes('System.out')) return 'Java';
      if (code.includes('func ') && code.includes('package main')) return 'Go';
      if (code.includes('fn ') && code.includes('let mut')) return 'Rust';
      if (code.includes('function ') || code.includes('const ') || code.includes('=>')) return 'JavaScript';
      if (code.includes('interface ') && code.includes(': number')) return 'TypeScript';
      return 'Unknown';
    }

    // Monaco language IDs returned by model.getLanguageId()
    const lower = rawLang.toLowerCase().trim();
    const monacoMap = {
      'cpp':        'C++',
      'c++':        'C++',
      'c':          'C',
      'python':     'Python',
      'python3':    'Python',
      'java':       'Java',
      'javascript': 'JavaScript',
      'typescript': 'TypeScript',
      'golang':     'Go',
      'go':         'Go',
      'rust':       'Rust',
      'csharp':     'C#',
      'kotlin':     'Kotlin',
      'swift':      'Swift',
      'scala':      'Scala',
      'ruby':       'Ruby',
      'php':        'PHP',
      'mysql':      'MySQL',
      'mssql':      'MS SQL Server',
      'oracle':     'Oracle SQL',
      'bash':       'Bash',
      'r':          'R',
      'racket':     'Racket',
      'erlang':     'Erlang',
      'elixir':     'Elixir',
      'dart':       'Dart',
    };

    if (monacoMap[lower]) return monacoMap[lower];

    // Partial match fallback (handles 'cpp20', 'python3.12', etc.)
    if (lower.startsWith('cpp') || lower.includes('c++')) return 'C++';
    if (lower.startsWith('python')) return 'Python';
    if (lower.startsWith('java') && !lower.startsWith('javascript')) return 'Java';
    if (lower.startsWith('javascript') || lower === 'js') return 'JavaScript';
    if (lower.startsWith('typescript') || lower === 'ts') return 'TypeScript';
    if (lower.startsWith('go')) return 'Go';
    if (lower.startsWith('rust')) return 'Rust';

    // Return raw string as-is if no mapping found (still traceable by Gemini)
    return rawLang;
  }

  function processExtractedCode(code, lang) {
    extractedCppCode = code;
    hideManualFallback();

    const lines = code.split('\n');
    const firstFewLines = lines.slice(0, 4).join('\n');

    verifyLangBadge.textContent = lang;
    verifyLengthBadge.textContent = `${code.length} chars (${lines.length} lines)`;
    verifyCodeSnippet.textContent = firstFewLines || code.substring(0, 100);
    verificationBanner.classList.remove('hidden');

    if (stateError.classList.contains('active')) {
      switchState('idle');
    }
  }

  function showManualFallback() {
    manualFallbackSection.classList.remove('hidden');
    if (extractedCppCode) {
      manualCodeInput.value = extractedCppCode;
    }
  }

  function hideManualFallback() {
    manualFallbackSection.classList.add('hidden');
  }

  function showError(msg) {
    errorMessageText.textContent = msg;
    switchState('error');
  }

  // --------------------------------------------------------------------------
  // EVENT HANDLERS & SETTINGS
  // --------------------------------------------------------------------------

  // Sync / Re-read Monaco Editor Code
  fetchCodeBtn.addEventListener('click', async () => {
    fetchCodeBtn.disabled = true;
    fetchCodeBtn.textContent = '🔄 Reading...';
    await readMonacoEditorCode();
    fetchCodeBtn.disabled = false;
    fetchCodeBtn.textContent = '🔄 Read Editor';
  });

  verifyPlayBtn.addEventListener('click', () => {
    startDryRun();
  });

  useManualCodeBtn.addEventListener('click', () => {
    const manualCode = manualCodeInput.value.trim();
    if (!manualCode) {
      alert("Please paste valid C++ solution code.");
      return;
    }
    processExtractedCode(manualCode, 'C++');
    startDryRun();
  });

  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    chrome.storage.local.get(['themePreference'], (res) => {
      if (res && res.themePreference === 'dark') {
        document.body.classList.add('dark-mode');
      }
    });

    themeToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      const isDark = document.body.classList.contains('dark-mode');
      chrome.storage.local.set({ themePreference: isDark ? 'dark' : 'light' });
    });
  }

  const tabTraceBtn = document.getElementById('tab-trace-btn');
  const tabVarsBtn = document.getElementById('tab-vars-btn');
  const tabOutputBtn = document.getElementById('tab-output-btn');
  const segmentedTabs = [tabTraceBtn, tabVarsBtn, tabOutputBtn];

  segmentedTabs.forEach(tabBtn => {
    if (!tabBtn) return;
    tabBtn.addEventListener('click', () => {
      segmentedTabs.forEach(b => b && b.classList.remove('active'));
      tabBtn.classList.add('active');

      const targetTab = tabBtn.dataset.tab;
      const codeBento = document.querySelector('.code-bento-card');
      const varsBento = document.querySelector('.variables-bento-card');
      const stackOutputSec = document.getElementById('stack-output-section');

      if (targetTab === 'trace') {
        if (codeBento) codeBento.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (targetTab === 'vars') {
        if (varsBento) varsBento.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (targetTab === 'output') {
        if (stackOutputSec) stackOutputSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  clearInputBtn.addEventListener('click', () => {
    sampleInputArea.value = '';
    StorageService.saveSampleInput(currentProblemSlug, '');
  });

  sampleInputArea.addEventListener('input', () => {
    StorageService.saveSampleInput(currentProblemSlug, sampleInputArea.value);
  });

  errorRetryBtn.addEventListener('click', () => {
    readMonacoEditorCode();
  });

  // START DRY RUN BUTTON
  startDryRunBtn.addEventListener('click', () => {
    startDryRun();
  });

  // Step Controls
  stepFirstBtn.addEventListener('click', () => jumpToStep(0));
  stepPrevBtn.addEventListener('click', () => jumpToStep(currentStepIndex - 1));
  stepNextBtn.addEventListener('click', () => jumpToStep(currentStepIndex + 1));
  stepLastBtn.addEventListener('click', () => jumpToStep(traceSteps.length - 1));

  stepPlayBtn.addEventListener('click', () => {
    toggleAutoPlay();
  });

  stepSlider.addEventListener('input', () => {
    const idx = parseInt(stepSlider.value) - 1;
    jumpToStep(idx);
  });

  document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') jumpToStep(currentStepIndex - 1);
    if (e.key === 'ArrowRight') jumpToStep(currentStepIndex + 1);
    if (e.key === 'Home') jumpToStep(0);
    if (e.key === 'End') jumpToStep(traceSteps.length - 1);
    if (e.key === ' ') {
      e.preventDefault();
      toggleAutoPlay();
    }
  });

  openDevtoolsLink.addEventListener('click', () => {
    alert("To view in DevTools: Press F12 or Right Click -> Inspect, and open the 'Dry Run C++' tab!");
  });

  // --------------------------------------------------------------------------
  // EXECUTION PIPELINE (AI Tracing via Background SW & Local Interpreter Fallback)
  // --------------------------------------------------------------------------

  async function startDryRun() {
    stopAutoPlay();

    if (!extractedCppCode || extractedCppCode.trim().length === 0) {
      await readMonacoEditorCode();
      if (!extractedCppCode || extractedCppCode.trim().length === 0) {
        showError("No solution code found. Please open a LeetCode problem with code in the editor.");
        showManualFallback();
        return;
      }
    }

    switchState('loading');

    const input = sampleInputArea.value;
    loadingMessage.textContent = `Sending ${detectedLanguage} code to Gemini for step-by-step trace...`;

    // Call Background Service Worker to execute Gemini AI tracing
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'GENERATE_AI_TRACE',
        code: extractedCppCode,
        language: detectedLanguage,
        input: input
      }, (res) => resolve(res || { success: false, error: "Service Worker did not respond." }));
    });

    if (!response.success) {
      showError(response.error || "Failed to generate AI execution trace.");
      return;
    }

    const traceData = response.trace;
    traceSteps = traceData.steps || [];
    finalTraceOutput = traceData.output || "Execution completed";

    if (traceSteps.length === 0) {
      showError("AI generated an empty execution trace.");
      return;
    }

    // Attach overall output to last step
    traceSteps[traceSteps.length - 1].output = finalTraceOutput;

    currentStepIndex = 0;
    stepSlider.max = traceSteps.length;
    totalStepsNumEl.textContent = traceSteps.length;

    renderCodeViewer(extractedCppCode);
    renderStep(currentStepIndex);
    switchState('result');
  }

  function renderStep(idx) {
    if (idx < 0 || idx >= traceSteps.length) return;
    currentStepIndex = idx;
    const step = traceSteps[idx];

    currentStepNumEl.textContent = `Step ${idx + 1}`;
    totalStepsNumEl.textContent = `${traceSteps.length}`;
    stepSlider.value = idx + 1;

    // Requirement #9: Progress bar showing current step / total steps
    if (progressBarFill) {
      const progressPct = ((idx + 1) / traceSteps.length) * 100;
      progressBarFill.style.width = `${progressPct}%`;
    }

    const lineNum = step.line || step.lineNumber || 1;
    lineNumBadge.textContent = `Line ${lineNum}`;
    stepExplanation.textContent = step.explanation || 'Executing C++ line statement.';

    highlightCodeLine(lineNum);

    // Highlight line live on LeetCode Monaco editor DOM
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].url.includes('leetcode.com')) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'HIGHLIGHT_LINE',
          lineNumber: lineNum
        }).catch(() => {});
      }
    });

    const prevVars = idx > 0 ? (traceSteps[idx - 1].variables || {}) : {};
    renderVariables(step.variables || {}, prevVars, idx);
    renderCallStack(step.callStack || ['Solution::solve()']);
    outputText.textContent = step.output || '--';

    // Requirement #10: Final output after trace finishes / on final step
    if (idx === traceSteps.length - 1) {
      const displayFinal = step.output || finalTraceOutput || "Execution completed";
      if (finalOutputText) finalOutputText.textContent = displayFinal;
      if (finalOutputCard) finalOutputCard.classList.remove('hidden');
    } else {
      if (finalOutputCard) finalOutputCard.classList.add('hidden');
    }
  }

  function renderCodeViewer(code) {
    codeLinesBox.innerHTML = '';
    const lines = code.split('\n');
    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const row = document.createElement('div');
      row.className = 'code-line-row';
      row.dataset.line = lineNum;

      const numEl = document.createElement('span');
      numEl.className = 'line-num';
      numEl.textContent = lineNum;

      const contentEl = document.createElement('span');
      contentEl.className = 'line-content';
      contentEl.textContent = line || ' ';

      row.appendChild(numEl);
      row.appendChild(contentEl);
      codeLinesBox.appendChild(row);
    });
  }

  function highlightCodeLine(lineNum) {
    const rows = codeLinesBox.querySelectorAll('.code-line-row');
    if (rows.length === 0) return;

    let boundedLine = parseInt(lineNum) || 1;
    if (boundedLine < 1) boundedLine = 1;
    if (boundedLine > rows.length) boundedLine = rows.length;

    activeLineIndicator.textContent = `Line ${boundedLine}`;

    rows.forEach(r => {
      if (parseInt(r.dataset.line) === boundedLine) {
        r.classList.add('active');
        r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        r.classList.remove('active');
      }
    });
  }

  // Requirement #5: Clearly indicate which variables changed from previous step
  function renderVariables(variablesObj, prevVariablesObj = {}, stepIdx = 0) {
    variableTableBody.innerHTML = '';
    const keys = Object.keys(variablesObj);
    let changedCount = 0;

    if (keys.length === 0) {
      variableTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280; padding:8px;">No local variables initialized in scope</td></tr>`;
      if (changedVarsBadge) changedVarsBadge.textContent = 'Step Scope';
      return;
    }

    keys.forEach(key => {
      const tr = document.createElement('tr');
      const val = variablesObj[key];
      const prevVal = prevVariablesObj[key];

      const isChanged = stepIdx > 0 && (
        !(key in prevVariablesObj) ||
        JSON.stringify(val) !== JSON.stringify(prevVal)
      );

      if (isChanged) {
        changedCount++;
        tr.className = 'var-row-changed';
      }

      const typeStr = getTypeStr(val);
      const valHtml = formatVariableValue(val);
      const nameHtml = isChanged 
        ? `${escapeHtml(key)} <span class="var-changed-badge" title="Variable modified in this step">⚡ UPDATED</span>`
        : escapeHtml(key);

      tr.innerHTML = `
        <td class="var-name">${nameHtml}</td>
        <td style="color:#9ca3af; font-size:10px;">${escapeHtml(typeStr)}</td>
        <td class="var-val">${valHtml}</td>
      `;
      variableTableBody.appendChild(tr);
    });

    if (changedVarsBadge) {
      if (stepIdx === 0) {
        changedVarsBadge.textContent = 'Initial Scope';
      } else if (changedCount > 0) {
        changedVarsBadge.textContent = `⚡ ${changedCount} Changed`;
      } else {
        changedVarsBadge.textContent = 'No Changes';
      }
    }
  }

  // Format arrays, vectors, maps, stacks, strings, booleans, and numbers
  function formatVariableValue(val) {
    if (val === null || val === undefined) {
      return '<span class="val-string">null</span>';
    }

    let parsed = val;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          parsed = JSON.parse(trimmed);
        } catch (e) {
          parsed = val;
        }
      }
    }

    if (Array.isArray(parsed)) {
      const itemsFormatted = parsed.map(item => {
        if (typeof item === 'string') return `"${escapeHtml(item)}"`;
        return escapeHtml(JSON.stringify(item));
      }).join(', ');
      return `<div class="val-struct-box">
        <span class="val-array-text">[${itemsFormatted}]</span>
        <span class="val-size-chip">size: ${parsed.length}</span>
      </div>`;
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const keys = Object.keys(parsed);
      const pairsFormatted = keys.map(k => `${escapeHtml(k)}: ${escapeHtml(JSON.stringify(parsed[k]))}`).join(', ');
      return `<div class="val-struct-box">
        <span class="val-array-text">{${pairsFormatted}}</span>
        <span class="val-size-chip">size: ${keys.length}</span>
      </div>`;
    }

    if (typeof val === 'string') {
      return `<span class="val-string">"${escapeHtml(val)}"</span>`;
    }

    if (typeof val === 'boolean') {
      return `<span class="val-bool">${val}</span>`;
    }

    if (typeof val === 'number') {
      return `<span class="val-num">${val}</span>`;
    }

    return `<span>${escapeHtml(String(val))}</span>`;
  }

  function getTypeStr(val) {
    if (val === null || val === undefined) return 'auto';

    let parsed = val;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) return 'vector';
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) return 'unordered_map';
    }

    if (Array.isArray(parsed)) return 'vector / array';
    if (typeof parsed === 'object' && parsed !== null) return 'map / struct';
    if (typeof val === 'number') return Number.isInteger(val) ? 'int' : 'double';
    if (typeof val === 'boolean') return 'bool';
    if (typeof val === 'string') return 'string';
    return 'auto';
  }

  function renderCallStack(stackArray) {
    callStackList.innerHTML = '';
    stackArray.forEach(func => {
      const tag = document.createElement('span');
      tag.className = 'stack-tag';
      tag.textContent = func;
      callStackList.appendChild(tag);
    });
  }

  function jumpToStep(idx) {
    if (idx < 0) idx = 0;
    if (idx >= traceSteps.length) idx = traceSteps.length - 1;
    renderStep(idx);
  }

  function toggleAutoPlay() {
    if (isPlaying) {
      stopAutoPlay();
    } else {
      startAutoPlay();
    }
  }

  function startAutoPlay() {
    isPlaying = true;
    stepPlayBtn.textContent = '⏸';
    stepPlayBtn.title = 'Pause Auto Step';

    const speed = stepSpeedMs || 800;
    playTimer = setInterval(() => {
      if (currentStepIndex < traceSteps.length - 1) {
        jumpToStep(currentStepIndex + 1);
      } else {
        stopAutoPlay();
      }
    }, speed);
  }

  function stopAutoPlay() {
    isPlaying = false;
    stepPlayBtn.textContent = '▶';
    stepPlayBtn.title = 'Play / Pause Auto Step';
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
  }

  function switchState(stateName) {
    [stateIdle, stateLoading, stateError, stateResult].forEach(el => {
      el.classList.remove('active');
      el.classList.add('hidden');
    });

    if (stateName === 'idle') stateIdle.classList.add('active');
    if (stateName === 'loading') stateLoading.classList.add('active');
    if (stateName === 'error') stateError.classList.add('active');
    if (stateName === 'result') stateResult.classList.add('active');
  }

  async function handleExtractedExamples(examples) {
    if (!exampleSelectorContainer) return;
    exampleSelectorContainer.innerHTML = '';

    if (!examples || examples.length === 0) {
      exampleSelectorContainer.classList.add('hidden');
      if (exampleStatusSubtext) {
        exampleStatusSubtext.textContent = 'No detectable examples found. Enter custom input manually below:';
        exampleStatusSubtext.classList.remove('hidden');
      }

      const savedInput = await StorageService.getSampleInput(currentProblemSlug);
      if (savedInput) {
        sampleInputArea.value = savedInput;
      }
      return;
    }

    if (exampleStatusSubtext) {
      exampleStatusSubtext.classList.add('hidden');
    }
    exampleSelectorContainer.classList.remove('hidden');

    const savedInput = await StorageService.getSampleInput(currentProblemSlug);
    let selectedIdx = 0;

    if (savedInput) {
      const matchIdx = examples.findIndex(e => e.input.trim() === savedInput.trim());
      if (matchIdx !== -1) {
        selectedIdx = matchIdx;
      }
    }

    examples.forEach((ex, idx) => {
      const btn = document.createElement('button');
      btn.className = `example-selector-btn ${idx === selectedIdx ? 'active' : ''}`;
      btn.textContent = ex.label || `Example ${idx + 1}`;
      btn.title = ex.input;

      btn.addEventListener('click', () => {
        const allBtns = exampleSelectorContainer.querySelectorAll('.example-selector-btn');
        allBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        sampleInputArea.value = ex.input;
        StorageService.saveSampleInput(currentProblemSlug, ex.input);
      });

      exampleSelectorContainer.appendChild(btn);
    });

    if (savedInput && savedInput.trim().length > 0) {
      sampleInputArea.value = savedInput;
    } else {
      sampleInputArea.value = examples[selectedIdx].input;
      StorageService.saveSampleInput(currentProblemSlug, examples[selectedIdx].input);
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
