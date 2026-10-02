/**
 * Background Service Worker (Manifest V3)
 * Manages extension state, tab tracking, and Gemini AI execution tracing.
 */

// Listener for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[DryRun Service Worker] Extension installed successfully.');
    chrome.storage.sync.set({
      theme: 'dark-dragon',
      apiProvider: 'gemini',
      stepSpeedMs: 800,
      autoTrace: true
    });
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
    handleGeminiAiTrace(message.code, message.input, message.modelName)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }
});

/**
 * Handles Gemini AI Tracing Requests in Background Service Worker
 * @param {string} code - C++ source code from Monaco Editor
 * @param {string} input - Sample input test case
 * @param {string} modelNameOverride - Selected Gemini model name
 */
async function handleGeminiAiTrace(code, input, modelNameOverride) {
  try {
    // Read user's API key securely from chrome.storage.local
    const storageResult = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = storageResult.geminiApiKey ? storageResult.geminiApiKey.trim() : '';

    if (!apiKey) {
      return {
        success: false,
        error: "Missing Gemini API Key. Please enter and save your Gemini API key in Settings (⚙️)."
      };
    }

    const modelName = modelNameOverride || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const prompt = `
You are an accurate C++ code execution tracer for LeetCode.
Your objective is to TRACE the user's exact C++ code step-by-step with the provided input. Do NOT solve the problem, do NOT fix the code, do NOT provide hints, and do NOT give the intended LeetCode solution.

Rules:
1. Follow the user's exact C++ code line by line.
2. Track 1-based line numbers.
3. Track current variable values including primitives, arrays, vectors, strings, maps, sets, and stacks.
4. Explain ONLY what the code is doing at that exact moment.
5. Never fix the code or suggest a better approach.
6. Never judge whether the algorithm is correct or optimal.
7. If the code contains a bug, logical error, or undefined behavior, trace the exact behavior caused by that code.
8. Limit the trace to a maximum of 40 meaningful steps. Merge repetitive loop iterations when necessary.
9. If sample input is empty, use a small reasonable test input for this function and mention it in the first step's explanation.
10. You must return ONLY valid JSON matching this exact structure:
{
  "steps": [
    {
      "step": 1,
      "line": 5,
      "explanation": "short explanation of line execution",
      "variables": {
        "i": 0,
        "sum": 0
      }
    }
  ],
  "output": "final return value or output description"
}

[C++ CODE TO TRACE]
${code}

[SAMPLE INPUT]
${input ? input : "(No input provided - using small reasonable default test case)"}
`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
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
      const errMsg = errJson.error?.message || `Gemini API returned status ${response.status}`;
      return { success: false, error: `Gemini API Error: ${errMsg}` };
    }

    const data = await response.json();
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
    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return {
        success: false,
        error: "Invalid trace response schema from Gemini API. Missing steps array."
      };
    }

    // Normalize steps array matching contract
    const normalizedSteps = parsed.steps.map((s, index) => ({
      step: s.step || (index + 1),
      line: s.line || s.lineNumber || 1,
      explanation: s.explanation || "Executing C++ line",
      variables: s.variables || {}
    }));

    return {
      success: true,
      trace: {
        steps: normalizedSteps,
        output: parsed.output || "Execution completed"
      }
    };

  } catch (err) {
    console.error("[DryRun SW] Gemini trace error:", err);
    return { success: false, error: `AI Execution Error: ${err.message}` };
  }
}
