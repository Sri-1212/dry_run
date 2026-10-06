/**
 * Background Service Worker (Manifest V3)
 * Manages extension state, tab tracking, and Gemini AI execution tracing.
 */

try {
  importScripts('/config.js');
} catch (e) {
  console.error('[DryRun SW] Failed to load /config.js via importScripts:', e);
}

// Listener for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[DryRun Service Worker] Extension installed successfully.');
  }
});

// Listener for message routing across extension components
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[DryRun Service Worker] Received action:', message.action);

  if (message.action === 'GET_ACTIVE_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ tab: tabs && tabs[0] ? tabs[0] : null });
    });
    return true;
  }

  if (message.action === 'GENERATE_AI_TRACE') {
    handleGeminiAiTrace(message.code, message.language || 'Unknown', message.input)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }
});

/**
 * Handles Gemini AI Tracing Requests in Background Service Worker
 * @param {string} code - Source code from Monaco Editor (any language)
 * @param {string} language - Detected language name (e.g. 'C++', 'Python', 'Java')
 * @param {string} input - Sample input test case
 */
async function handleGeminiAiTrace(code, language, input) {
  const apiKey = (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_API_KEY) ? CONFIG.GEMINI_API_KEY.trim() : '';
  const modelName = (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_MODEL) ? CONFIG.GEMINI_MODEL.trim() : 'gemini-2.5-flash';
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
    console.error('[DryRun SW] Gemini API key is empty or still uses its placeholder.');
    return { success: false, error: 'Gemini API key is empty. Add your key to config.js.' };
  }

  const lineCount = String(code || '').split(/\r?\n/).length;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const systemPrompt = `Act only as a strict C++ execution tracer. Trace exactly what the supplied code does with the supplied input, line by line. Use 1-based source line numbers and report only the current values and effects for the exact line being traced. Every step explanation must describe only what that line does with the current values. Never give the solution, hints, fixes, alternative code, an optimal approach, complexity analysis, or any judgment about correctness. If the code contains a bug or undefined behavior, trace its buggy behavior faithfully without correcting or evaluating it. Merge repetitive loop iterations and return at most 30 steps. Return only JSON matching the response schema.`;
  const prompt = `[SOURCE CODE]\n${code}\n\n[SELECTED TESTCASE INPUT]\n${input || '(none provided)'}`;
  const responseSchema = {
    type: 'OBJECT',
    properties: {
      steps: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            step: { type: 'INTEGER' },
            line: { type: 'INTEGER' },
            explanation: { type: 'STRING' },
            variables: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING' },
                  value: { type: 'STRING' }
                },
                required: ['name', 'value']
              }
            },
            output: { type: 'STRING' }
          },
          required: ['step', 'line', 'explanation', 'variables']
        }
      },
      output: { type: 'STRING' }
    },
    required: ['steps', 'output']
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema,
            temperature: 0
          }
        })
      });
    } catch (error) {
      console.error('[DryRun SW] Gemini network failure:', error);
      return { success: false, error: 'Network failure contacting Gemini. Check your connection and try again.' };
    }

    let rawApiResponse;
    try {
      rawApiResponse = await response.text();
    } catch (error) {
      console.error('[DryRun SW] Failed to read Gemini API response:', error);
      return { success: false, error: 'Network failure while reading Gemini response. Check your connection and try again.' };
    }
    let data = {};
    try {
      data = rawApiResponse ? JSON.parse(rawApiResponse) : {};
    } catch (error) {
      console.error('[DryRun SW] Invalid Gemini API response JSON:', error, rawApiResponse);
      if (attempt === 1) continue;
      return { success: false, error: 'Gemini returned invalid JSON twice. Try again.' };
    }

    if (!response.ok) {
      console.error('[DryRun SW] Gemini API error response:', { status: response.status, data, rawApiResponse });
      const apiMessage = data.error?.message || '';
      if (response.status === 401 || response.status === 403 || /api key not valid|invalid api key/i.test(apiMessage)) {
        return { success: false, error: 'Invalid Gemini API key (HTTP 403). Check GEMINI_API_KEY in config.js.' };
      }
      if (response.status === 404) {
        return { success: false, error: `Gemini model not found (HTTP 404): ${modelName}.` };
      }
      if (response.status === 429) {
        return { success: false, error: 'Gemini rate limit reached (HTTP 429). Wait and try again.' };
      }
      return { success: false, error: apiMessage || `Gemini API returned HTTP ${response.status}.` };
    }

    console.log('[DryRun SW] Gemini raw API response:', data, rawApiResponse);
    const rawText = data.candidates?.[0]?.content?.parts?.find(part => typeof part.text === 'string')?.text || '';
    let parsed;
    try {
      const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (error) {
      console.error('[DryRun SW] Gemini trace JSON parse failure:', error, rawApiResponse, rawText);
      if (attempt === 1) continue;
      return { success: false, error: 'Gemini returned invalid trace JSON twice. Try again.' };
    }

    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      console.error('[DryRun SW] Gemini response contained no trace steps:', rawApiResponse);
      if (attempt === 1) continue;
      return { success: false, error: 'Gemini returned no trace steps after retry. Try again.' };
    }

    const normalizedSteps = [];
    for (const step of parsed.steps) {
      if (!step || !Number.isInteger(step.line) || step.line < 1 || step.line > lineCount ||
          typeof step.explanation !== 'string' || !Array.isArray(step.variables) ||
          !step.variables.every(variable => variable && typeof variable.name === 'string' && variable.name.trim() &&
            Object.prototype.hasOwnProperty.call(variable, 'value') &&
            (typeof variable.value === 'string' || typeof variable.value === 'number' || typeof variable.value === 'boolean'))) {
        console.warn('[DryRun SW] Dropping invalid trace step:', step);
        continue;
      }
      if (normalizedSteps.length === 30) break;

      normalizedSteps.push({
        step: normalizedSteps.length + 1,
        line: step.line,
        explanation: step.explanation.trim(),
        variables: Object.fromEntries(step.variables.map(variable => [variable.name.trim(), String(variable.value)])),
        ...(typeof step.output === 'string' ? { output: step.output } : {}),
        callStack: ['Solution::solve()']
      });
    }

    if (normalizedSteps.length === 0) {
      console.error('[DryRun SW] Gemini response had no valid steps after validation:', rawApiResponse);
      if (attempt === 1) continue;
      return { success: false, error: 'Gemini returned no valid trace steps after retry. Check the code and try again.' };
    }

    return {
      success: true,
      trace: {
        steps: normalizedSteps,
        output: typeof parsed.output === 'string' ? parsed.output : 'Execution completed'
      }
    };
  }

  return { success: false, error: 'Gemini could not generate a valid trace after retry. Try again.' };
}
