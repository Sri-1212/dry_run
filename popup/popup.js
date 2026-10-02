/**
 * Popup Logic for Dry Run Chrome Extension
 * Direct LeetCode Monaco Editor integration using chrome.scripting.executeScript (world: MAIN).
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
  const apiKeyGroup = document.getElementById('api-key-group');
  const apiKeyInput = document.getElementById('api-key');
  const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility');
  const modelNameGroup = document.getElementById('model-name-group');
  const modelNameInput = document.getElementById('model-name');
  const stepSpeedInput = document.getElementById('step-speed');
  const speedLabel = document.getElementById('speed-label');
  const sampleInputArea = document.getElementById('sample-input');
  const startDryRunBtn = document.getElementById('start-dryrun-btn');

  // Verification Banner Elements (Requirement 8)
  const verificationBanner = document.getElementById('verification-banner');
  const verifyLangBadge = document.getElementById('verify-lang-badge');
  const verifyLengthBadge = document.getElementById('verify-length-badge');
  const verifyCodeSnippet = document.getElementById('verify-code-snippet');
  const verifyPlayBtn = document.getElementById('verify-play-btn');

  // Manual Fallback Elements (Requirement 7)
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
  const toggleFallbackBtn = document.getElementById('toggle-fallback-btn');

  // Step Result Controls & Views
  const stepFirstBtn = document.getElementById('step-first');
  const stepPrevBtn = document.getElementById('step-prev');
  const stepPlayBtn = document.getElementById('step-play');
  const stepNextBtn = document.getElementById('step-next');
  const stepLastBtn = document.getElementById('step-last');
  const currentStepNumEl = document.getElementById('current-step-num');
  const totalStepsNumEl = document.getElementById('total-steps-num');
  const stepSlider = document.getElementById('step-slider');
  const lineNumBadge = document.getElementById('line-num-badge');
  const stepExplanation = document.getElementById('step-explanation');
  const codeLinesBox = document.getElementById('code-lines-box');
  const activeLineIndicator = document.getElementById('active-line-indicator');
  const variableTableBody = document.getElementById('variable-table-body');
  const callStackList = document.getElementById('call-stack-list');
  const outputText = document.getElementById('output-text');
  const openDevtoolsLink = document.getElementById('open-devtools-link');

  // App State Variables
  let currentSettings = {};
  let currentProblemSlug = '';
  let extractedCppCode = ''; // Full code kept internally for AI trace (Requirement 9)
  let detectedLanguage = 'C++';
  let traceSteps = [];
  let currentStepIndex = 0;
  let isPlaying = false;
  let playTimer = null;

  // Load Saved Settings
  currentSettings = await StorageService.getSettings();
  applySettingsToUI(currentSettings);

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
  // CORE MONACO EDITOR READER (Requirements 1, 2, 3, 4, 5, 6, 7, 8, 9)
  // --------------------------------------------------------------------------

  /**
   * Main function to read C++ code directly from LeetCode Monaco editor
   * using chrome.scripting.executeScript in world: 'MAIN'.
   */
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

      // Execute script in page's MAIN world context to access Monaco instance
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: extractMonacoFromPage
      }).catch(err => {
        console.warn("[DryRun] Script execution error:", err);
        return null;
      });

      if (!results || !results[0] || !results[0].result) {
        // Content script fallback if scripting API fails
        const contentRes = await chrome.tabs.sendMessage(tab.id, { action: 'GET_LEETCODE_CODE' }).catch(() => null);
        if (contentRes && contentRes.code) {
          processExtractedCode(contentRes.code, 'C++');
          return;
        }
        showError("Unable to access Monaco editor automatically. Please paste your C++ code manually below.");
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

      // Requirement 5: Empty editor check
      if (!rawCode || rawCode.trim().length === 0) {
        showError("LeetCode editor is empty. Please enter or paste your C++ solution.");
        showManualFallback();
        return;
      }

      // Requirement 4: Detect Language & validate C++
      const langNorm = normalizeLanguage(rawLang, rawCode);
      detectedLanguage = langNorm;
      detectedLangChip.textContent = langNorm;

      if (!isCppLanguage(langNorm)) {
        showError("Support C++ only"); // Exact requirement 4 error message
        showManualFallback();
        return;
      }

      // Requirement 8 & 9: Keep full code internally, display verification banner
      processExtractedCode(rawCode, langNorm);

    } catch (err) {
      console.error("[DryRun] Monaco read error:", err);
      showError(`Monaco Access Error: ${err.message}`);
      showManualFallback();
    }
  }

  /**
   * Function executed directly inside the LeetCode web page context (MAIN world)
   */
  function extractMonacoFromPage() {
    try {
      let code = '';
      let lang = '';

      const m = window.monaco || window.Monaco;
      if (m && m.editor) {
        const models = m.editor.getModels ? m.editor.getModels() : [];
        if (models.length > 0) {
          // Requirement 4 spec check: models[1] or models[0] or getMode
          let targetModel = models.length > 1 ? models[1] : models[0];

          // Check Monaco.editor.getMode(models[1])[0].getValue pattern if available
          if (m.editor.getMode && models[1]) {
            try {
              const modeRes = m.editor.getMode(models[1]);
              if (modeRes && modeRes[0] && typeof modeRes[0].getValue === 'function') {
                code = modeRes[0].getValue();
              }
            } catch (e) {}
          }

          if (!code && targetModel) {
            if (typeof targetModel.getValue === 'function') {
              code = targetModel.getValue();
            }
            if (typeof targetModel.getLanguageId === 'function') {
              lang = targetModel.getLanguageId();
            }
          }
        }

        // Active editor fallback
        if (!code && m.editor.getEditors) {
          const editors = m.editor.getEditors();
          for (const ed of editors) {
            const val = ed.getValue ? ed.getValue() : '';
            if (val && val.trim().length > 0) {
              code = val;
              const model = ed.getModel ? ed.getModel() : null;
              if (model && model.getLanguageId) lang = model.getLanguageId();
              break;
            }
          }
        }
      }

      // Language detection from DOM if model language wasn't explicit
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

      // DOM fallback line reader
      if (!code) {
        const viewLines = document.querySelectorAll('.monaco-editor .view-line');
        if (viewLines && viewLines.length > 0) {
          code = Array.from(viewLines).map(l => l.textContent || '').join('\n');
        }
      }

      return {
        success: true,
        code: code || '',
        language: lang || ''
      };
    } catch (e) {
      return { success: false, error: e.toString() };
    }
  }

  function normalizeLanguage(rawLang, code) {
    if (!rawLang) {
      // Infer from code syntax if missing
      if (code.includes('#include') || code.includes('using namespace std') || code.includes('vector<') || code.includes('class Solution')) {
        return 'C++';
      }
      if (code.includes('def ') || code.includes('import ')) return 'Python';
      if (code.includes('public class ') || code.includes('System.out')) return 'Java';
      if (code.includes('function ') || code.includes('const ') || code.includes('let ')) return 'JavaScript';
      return 'C++'; // default to C++ if ambiguous
    }

    const lower = rawLang.toLowerCase().trim();
    if (lower.includes('cpp') || lower.includes('c++') || lower.includes('g++')) return 'C++';
    if (lower.includes('python')) return 'Python';
    if (lower.includes('java')) return 'Java';
    if (lower.includes('javascript') || lower.includes('js')) return 'JavaScript';
    if (lower.includes('typescript') || lower.includes('ts')) return 'TypeScript';
    if (lower.includes('golang') || lower.includes('go')) return 'Go';
    if (lower.includes('rust')) return 'Rust';
    if (lower === 'c') return 'C';
    if (lower.includes('c#') || lower.includes('csharp')) return 'C#';

    return rawLang;
  }

  function isCppLanguage(lang) {
    const l = lang.toLowerCase();
    return l.includes('c++') || l.includes('cpp') || l.includes('g++');
  }

  /**
   * Process and verify extracted code (Requirement 8 & 9)
   */
  function processExtractedCode(code, lang) {
    extractedCppCode = code; // Full code available internally for AI trace (Requirement 9)
    hideManualFallback();

    const lines = code.split('\n');
    const firstFewLines = lines.slice(0, 4).join('\n');

    // Requirement 8: Display Verification Banner with "Play", "Detect Language", and "Code Length"
    verifyLangBadge.textContent = lang;
    verifyLengthBadge.textContent = `${code.length} chars (${lines.length} lines)`;
    verifyCodeSnippet.textContent = firstFewLines || code.substring(0, 100);
    verificationBanner.classList.remove('hidden');

    // Reset error state if active
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
  // EVENT HANDLERS
  // --------------------------------------------------------------------------

  // Sync / Re-read Monaco Editor Code
  fetchCodeBtn.addEventListener('click', async () => {
    fetchCodeBtn.disabled = true;
    fetchCodeBtn.textContent = '🔄 Reading...';
    await readMonacoEditorCode();
    fetchCodeBtn.disabled = false;
    fetchCodeBtn.textContent = '🔄 Read Editor';
  });

  // Play Verification Button
  verifyPlayBtn.addEventListener('click', () => {
    startDryRun();
  });

  // Use Manual Code Button (Requirement 7)
  useManualCodeBtn.addEventListener('click', () => {
    const manualCode = manualCodeInput.value.trim();
    if (!manualCode) {
      alert("Please paste valid C++ solution code.");
      return;
    }
    processExtractedCode(manualCode, 'C++');
    startDryRun();
  });

  toggleFallbackBtn.addEventListener('click', () => {
    showManualFallback();
  });

  // Toggle Settings Panel
  toggleSettingsBtn.addEventListener('click', () => {
    settingsSection.classList.toggle('hidden');
  });

  // Provider Select Change
  apiProviderSelect.addEventListener('change', () => {
    const val = apiProviderSelect.value;
    if (val === 'interpreter') {
      apiKeyGroup.classList.add('hidden');
      modelNameGroup.classList.add('hidden');
    } else {
      apiKeyGroup.classList.remove('hidden');
      modelNameGroup.classList.remove('hidden');
      if (val === 'gemini') modelNameInput.value = 'gemini-1.5-pro';
      if (val === 'openai') modelNameInput.value = 'gpt-4o-mini';
    }
    saveCurrentSettings();
  });

  toggleKeyVisibilityBtn.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  [apiKeyInput, modelNameInput, stepSpeedInput].forEach(el => {
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
    if (e.key === ' ') {
      e.preventDefault();
      toggleAutoPlay();
    }
  });

  openDevtoolsLink.addEventListener('click', () => {
    alert("To view in DevTools: Press F12 or Right Click -> Inspect, and open the 'Dry Run C++' tab!");
  });

  // --------------------------------------------------------------------------
  // EXECUTION & RENDERING PIPELINE
  // --------------------------------------------------------------------------

  async function startDryRun() {
    stopAutoPlay();

    if (!extractedCppCode || extractedCppCode.trim().length === 0) {
      await readMonacoEditorCode();
      if (!extractedCppCode || extractedCppCode.trim().length === 0) {
        showError("No C++ solution code available to dry run.");
        showManualFallback();
        return;
      }
    }

    if (!isCppLanguage(detectedLanguage)) {
      showError("Support C++ only");
      showManualFallback();
      return;
    }

    switchState('loading');
    loadingMessage.textContent = `Analyzing Monaco C++ solution code & simulating step trace...`;

    try {
      const input = sampleInputArea.value;
      const options = {
        apiKey: apiKeyInput.value.trim(),
        apiProvider: apiProviderSelect.value,
        modelName: modelNameInput.value.trim()
      };

      // Full code passed internally to tracer (Requirement 9)
      traceSteps = await CppDryRunner.execute(extractedCppCode, input, options);

      if (!traceSteps || traceSteps.length === 0) {
        throw new Error("No trace execution steps generated.");
      }

      currentStepIndex = 0;
      stepSlider.max = traceSteps.length;
      totalStepsNumEl.textContent = traceSteps.length;

      renderCodeViewer(extractedCppCode);
      renderStep(currentStepIndex);
      switchState('result');
    } catch (err) {
      console.error('[DryRun Popup] Execution error:', err);
      showError(err.message || 'An unknown error occurred during C++ dry run.');
    }
  }

  function renderStep(idx) {
    if (idx < 0 || idx >= traceSteps.length) return;
    currentStepIndex = idx;
    const step = traceSteps[idx];

    currentStepNumEl.textContent = `Step ${idx + 1}`;
    stepSlider.value = idx + 1;

    lineNumBadge.textContent = `Line ${step.lineNumber || 1}`;
    stepExplanation.textContent = step.explanation || 'Executing C++ line statement.';

    highlightCodeLine(step.lineNumber || 1);

    // Highlight live on LeetCode Monaco editor DOM
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].url.includes('leetcode.com')) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'HIGHLIGHT_LINE',
          lineNumber: step.lineNumber || 1
        }).catch(() => {});
      }
    });

    renderVariables(step.variables || {}, step.memoryHighlight || []);
    renderCallStack(step.callStack || ['Solution::solve()']);
    outputText.textContent = step.output || '--';
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
    activeLineIndicator.textContent = `Line ${lineNum}`;
    const rows = codeLinesBox.querySelectorAll('.code-line-row');
    rows.forEach(r => {
      if (parseInt(r.dataset.line) === lineNum) {
        r.classList.add('active');
        r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        r.classList.remove('active');
      }
    });
  }

  function renderVariables(variablesObj, highlightArray = []) {
    variableTableBody.innerHTML = '';
    const keys = Object.keys(variablesObj);

    if (keys.length === 0) {
      variableTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#6b7280; padding:8px;">No local variables initialized in scope</td></tr>`;
      return;
    }

    keys.forEach(key => {
      const tr = document.createElement('tr');
      if (highlightArray.includes(key)) {
        tr.classList.add('var-modified');
      }

      const valStr = typeof variablesObj[key] === 'object' ? JSON.stringify(variablesObj[key]) : String(variablesObj[key]);
      const typeStr = getTypeStr(variablesObj[key]);

      tr.innerHTML = `
        <td class="var-name">${key}</td>
        <td style="color:#9ca3af;">${typeStr}</td>
        <td class="var-val">${escapeHtml(valStr)}</td>
      `;
      variableTableBody.appendChild(tr);
    });
  }

  function getTypeStr(val) {
    if (Array.isArray(val) || (typeof val === 'string' && val.startsWith('['))) return 'vector<int>';
    if (typeof val === 'number') return 'int';
    if (typeof val === 'boolean') return 'bool';
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

  function applySettingsToUI(s) {
    apiProviderSelect.value = s.apiProvider || 'interpreter';
    apiKeyInput.value = s.apiKey || '';
    modelNameInput.value = s.modelName || 'gemini-1.5-pro';
    stepSpeedInput.value = s.stepSpeedMs || 800;
    speedLabel.textContent = `${stepSpeedInput.value}ms`;

    if (s.apiProvider === 'interpreter') {
      apiKeyGroup.classList.add('hidden');
      modelNameGroup.classList.add('hidden');
    } else {
      apiKeyGroup.classList.remove('hidden');
      modelNameGroup.classList.remove('hidden');
    }
  }

  function saveCurrentSettings() {
    currentSettings = {
      apiProvider: apiProviderSelect.value,
      apiKey: apiKeyInput.value.trim(),
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
