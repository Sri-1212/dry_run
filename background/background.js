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
  try {
    const apiKey = (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_API_KEY) ? CONFIG.GEMINI_API_KEY.trim() : '';
    const modelName = (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_MODEL) ? CONFIG.GEMINI_MODEL.trim() : 'gemini-2.5-flash';

    if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY") {
      return {
        success: false,
        error: "Missing Gemini API Key. Please configure your GEMINI_API_KEY in config.js."
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const systemPrompt = `Act as a strict C++ code tracer. Trace exactly what the given code does with the given input, line by line. Use 1-based line numbers matching the supplied code. Never suggest fixes, never give the solution, never mention the optimal approach, and never judge correctness. If the code has a bug or undefined behavior, trace the buggy behavior faithfully. Record the in-scope variables at each step as name/value pairs, with values represented as strings. Return no more than 40 steps, merging repetitive loop iterations. If no input is provided, choose a small input and state it in the first explanation. Return only JSON matching the required schema.`;
    const prompt = `[SOURCE CODE]\n${code}\n\n[SELECTED TESTCASE INPUT]\n${input || '(none provided)'}`;

    const requestBody = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            steps: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  step: { type: "INTEGER" },
                  line: { type: "INTEGER" },
                  explanation: { type: "STRING" },
                  variables: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        name: { type: "STRING" },
                        value: { type: "STRING" }
                      },
                      required: ["name", "value"]
                    }
                  },
                  output: { type: "STRING" }
                },
                required: ["step", "line", "explanation", "variables"]
              }
            },
            output: { type: "STRING" }
          },
          required: ["steps", "output"]
        },
        temperature: 0.1
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      console.error('[DryRun SW] Gemini API error response:', errJson);
      const apiMessage = errJson.error?.message || '';
      const errorCode = errJson.error?.status || '';
      if (response.status === 401 || /api key not valid|invalid api key/i.test(apiMessage)) {
        return { success: false, error: 'Invalid API key. Check GEMINI_API_KEY in config.js.' };
      }
      if (response.status === 404 || /not found/i.test(apiMessage)) {
        return { success: false, error: `Model not found: ${modelName}. Check GEMINI_MODEL in config.js.` };
      }
      if (response.status === 429 || /resource_exhausted|rate limit/i.test(errorCode + apiMessage)) {
        return { success: false, error: 'Rate limit reached. Wait a moment and try again.' };
      }
      return { success: false, error: apiMessage || `Gemini API returned status ${response.status}` };
    }

    const data = await response.json();
    console.log('[DryRun SW] Gemini raw API response:', data);
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return { success: false, error: "Received empty response from Gemini API." };
    }

    // Clean and parse JSON response
    let parsed;
    try {
      const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("[DryRun SW] JSON Parse error on Gemini response:", parseErr, rawText);
      return {
        success: false,
        error: "Failed to parse AI execution trace JSON. Please check your C++ code syntax and try again."
      };
    }

    // Validate tracing contract structure
    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0 || parsed.steps.length > 40) {
      return {
        success: false,
        error: "Invalid trace response from Gemini API. Expected between 1 and 40 steps."
      };
    }

    const normalizedSteps = [];
    for (const [index, step] of parsed.steps.entries()) {
      if (!step || !Number.isInteger(step.step) || !Number.isInteger(step.line) ||
          typeof step.explanation !== 'string' || !Array.isArray(step.variables) ||
          !step.variables.every(variable => variable && typeof variable.name === 'string' &&
            (typeof variable.value === 'string' || typeof variable.value === 'number' || typeof variable.value === 'boolean'))) {
        return { success: false, error: `Invalid trace response: step ${index + 1} has an invalid shape.` };
      }

      normalizedSteps.push({
        step: step.step,
        line: step.line,
        explanation: step.explanation,
        variables: Object.fromEntries(step.variables.map(variable => [variable.name, variable.value])),
        ...(typeof step.output === 'string' ? { output: step.output } : {}),
        callStack: ['Solution::solve()']
      });
    }

    return {
      success: true,
      trace: {
        steps: normalizedSteps,
        output: typeof parsed.output === 'string' ? parsed.output : "Execution completed"
      }
    };

  } catch (err) {
    console.error("[DryRun SW] Gemini trace error:", err);
    return { success: false, error: err.message || 'Could not connect to Gemini. Check your network and try again.' };
  }
}
