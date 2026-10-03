/**
 * Popup Logic for Dry Run Chrome Extension
 * Direct LeetCode Monaco Editor integration using chrome.scripting.executeScript (world: MAIN)
 * and Gemini AI execution tracing via background service worker.
 */

import { StorageService } from '../utils/storage.js';
import { LeetCodeHelper } from '../utils/leetcode_api.js';
import { CppDryRunner } from '../utils/cpp_parser.js';

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const problemTitleEl = document.getElementById('problem-title');
  const detectedLangChip = document.getElementById('detected-lang-chip');
  const fetchCodeBtn = document.getElementById('fetch-code-btn');
  const toggleSettingsBtn = document.getElementById('toggle-settings-btn');
  const settingsSection = document.getElementById('settings-section');
  const apiProviderSelect = document.getElementById('api-provider');
  const geminiKeyGroup = document.getElementById('gemini-key-group');
  const geminiApiKeyInput = document.getElementById('gemini-api-key');
  const keySavedStatus = document.getElementById('key-saved-status');
  const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility');
  const modelNameGroup = document.getElementById('model-name-group');
  const modelNameInput = document.getElementById('model-name');
  const stepSpeedInput = document.getElementById('step-speed');
  const speedLabel = document.getElementById('speed-label');
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

  // Presets
  const preset1Btn = document.getElementById('preset-1-btn');
  const preset2Btn = document.getElementById('preset-2-btn');
  const clearInputBtn = document.getElementById('clear-input-btn');

  // State Containers
  const stateIdle = document.getElementById('state-idle');
  const stateLoading = document.getElementById('state-loading');
  const stateError = document.getElementById('state-error');
  const stateResult = document.getElementById('state-result');
  const loadingMessage = document.getElementById('loading-message');
  const errorMessageText = document.getElementById('error-message-text');
  const errorRetryBtn = document.getElementById('error-retry-btn');
  const switchInterpreterBtn = document.getElementById('switch-interpreter-btn');

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

  // Load Saved Settings & Gemini API Key
  currentSettings = await StorageService.getSettings();
  const savedApiKey = await StorageService.getGeminiApiKey();
  applySettingsToUI(currentSettings, savedApiKey);

  // Initial Read from Active LeetCode Monaco Editor
  await readMonacoEditorCode();

  // Load Saved Sample Input
  const savedInput = await StorageService.getSampleInput(currentProblemSlug);
  if (savedInput) {
    sampleInputArea.value = savedInput;
  } else {
    sampleInputArea.value = `nums = [2, 7, 11, 15]\ntarget = 9`;
  }

  // --------------------------------------------------------------------------
  // CORE MONACO EDITOR READER
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

      // Execute script in page's MAIN world context to access active Monaco instance
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: extractMonacoFromPage
      }).catch(err => {
        console.warn("[DryRun] Script execution error:", err);
        return null;
      });

      if (!results || !results[0] || !results[0].result) {
        const contentRes = await chrome.tabs.sendMessage(tab.id, { action: 'GET_LEETCODE_CODE' }).catch(() => null);
        if (contentRes && contentRes.code) {
          const guessedLang = normalizeLanguage('', contentRes.code);
          processExtractedCode(contentRes.code, guessedLang);
          return;
        }
        showError("Unable to access Monaco editor automatically. Please paste your code manually below.");
        showManualFallback();
        return;
      }

      const res = results[0].result;
      if (!res.success) {
        showError(res.error || "Failed to access Monaco editor.");
        showManualFallback();
        return;
      }

      const rawCode = res.code;
      const rawLang = res.language;

      if (!rawCode || rawCode.trim().length === 0) {
        showError("LeetCode editor is empty. Please write or paste your solution first.");
        showManualFallback();
        return;
      }

      const langNorm = normalizeLanguage(rawLang, rawCode);
      detectedLanguage = langNorm;
      detectedLangChip.textContent = langNorm;

      processExtractedCode(rawCode, langNorm);

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

      return {
        success: true,
        code: code || '',
        language: lang || '',
        methodUsed: methodUsed || 'None'
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

  toggleSettingsBtn.addEventListener('click', () => {
    settingsSection.classList.toggle('hidden');
  });

  apiProviderSelect.addEventListener('change', () => {
    const val = apiProviderSelect.value;
    if (val === 'interpreter') {
      geminiKeyGroup.classList.add('hidden');
      modelNameGroup.classList.add('hidden');
    } else {
      geminiKeyGroup.classList.remove('hidden');
      modelNameGroup.classList.remove('hidden');
    }
    saveCurrentSettings();
  });

  toggleKeyVisibilityBtn.addEventListener('click', () => {
    geminiApiKeyInput.type = geminiApiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // Save Gemini API Key securely in chrome.storage.local
  geminiApiKeyInput.addEventListener('input', async () => {
    const val = geminiApiKeyInput.value.trim();
    await StorageService.saveGeminiApiKey(val);
    updateKeyStatusBadge(val);
  });

  [modelNameInput, stepSpeedInput].forEach(el => {
    el.addEventListener('input', () => {
      speedLabel.textContent = `${stepSpeedInput.value}ms`;
      saveCurrentSettings();
    });
  });

  preset1Btn.addEventListener('click', () => {
    sampleInputArea.value = `nums = [2, 7, 11, 15]\ntarget = 9`;
    StorageService.saveSampleInput(currentProblemSlug, sampleInputArea.value);
  });

  preset2Btn.addEventListener('click', () => {
    sampleInputArea.value = `s = "abcabcbb"`;
    StorageService.saveSampleInput(currentProblemSlug, sampleInputArea.value);
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

  switchInterpreterBtn.addEventListener('click', () => {
    apiProviderSelect.value = 'interpreter';
    saveCurrentSettings();
    applySettingsToUI(currentSettings, geminiApiKeyInput.value);
    startDryRun();
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

    const provider = apiProviderSelect.value;
    const input = sampleInputArea.value;

    if (provider === 'gemini') {
      loadingMessage.textContent = `Sending ${detectedLanguage} code to Gemini for step-by-step trace...`;

      // Call Background Service Worker to execute Gemini AI tracing
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'GENERATE_AI_TRACE',
          code: extractedCppCode,
          language: detectedLanguage,
          input: input,
          modelName: modelNameInput.value
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

    } else {
      // Built-in C++ Interpreter execution
      loadingMessage.textContent = `Simulating local C++ execution trace...`;
      try {
        traceSteps = CppDryRunner.simulateLocalCpp(extractedCppCode, input);
        const last = traceSteps[traceSteps.length - 1];
        finalTraceOutput = last?.output || "Execution completed";
      } catch (err) {
        showError(`Local Interpreter Error: ${err.message}`);
        return;
      }
    }

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

    const speed = parseInt(stepSpeedInput.value) || 800;
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

  function applySettingsToUI(s, apiKey) {
    apiProviderSelect.value = s.apiProvider || 'gemini';
    modelNameInput.value = s.modelName || 'gemini-3.8-flash';
    stepSpeedInput.value = s.stepSpeedMs || 800;
    speedLabel.textContent = `${stepSpeedInput.value}ms`;

    if (apiKey) {
      geminiApiKeyInput.value = apiKey;
      updateKeyStatusBadge(apiKey);
    } else {
      geminiApiKeyInput.value = '';
      updateKeyStatusBadge('');
    }

    if (s.apiProvider === 'interpreter') {
      geminiKeyGroup.classList.add('hidden');
      modelNameGroup.classList.add('hidden');
    } else {
      geminiKeyGroup.classList.remove('hidden');
      modelNameGroup.classList.remove('hidden');
    }
  }

  function updateKeyStatusBadge(key) {
    if (key && key.length > 5) {
      keySavedStatus.textContent = '✅ Key Saved';
      keySavedStatus.className = 'key-status-badge configured';
    } else {
      keySavedStatus.textContent = 'Not Set';
      keySavedStatus.className = 'key-status-badge unconfigured';
    }
  }

  function saveCurrentSettings() {
    currentSettings = {
      apiProvider: apiProviderSelect.value,
      modelName: modelNameInput.value.trim(),
      stepSpeedMs: parseInt(stepSpeedInput.value)
    };
    StorageService.saveSettings(currentSettings);
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
