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

    const prompt = `
You are an exact, step-by-step code execution tracer for LeetCode.
The user's solution is written in ${language}.
Your only job is to TRACE what the code actually does — step by step — with the provided input.

Strict rules:
1. Follow the user's exact ${language} source code line by line. Do not alter, fix, or reorder it.
2. Use 1-based line numbers matching the exact source code supplied.
3. At every step, record the current values of ALL in-scope variables, including:
   - Primitives (int, bool, char, float, double, etc.)
   - Strings
   - Arrays, lists, vectors, slices
   - Maps, dicts, hashmaps, sets
   - Stacks, queues, deques
   - Objects/structs (show their fields)
4. The "explanation" field must describe only what is happening at that exact line — nothing more.
5. Never fix the code, never suggest improvements, never give hints, never provide the correct LeetCode solution.
6. Never judge whether the algorithm is correct, optimal, or wrong.
7. If the code has a bug or undefined behavior, trace the exact behavior the code would produce — including wrong outputs.
8. Limit the trace to at most 40 meaningful steps. Merge consecutive identical loop iterations into a single summarized step when the variable change is repetitive.
9. If no sample input is provided, invent a small, reasonable test input for the function and state it clearly in the first step's explanation.
10. Return ONLY valid JSON with no markdown, no commentary, no code fences — just the raw JSON object:
{
  "steps": [
    {
      "step": 1,
      "line": 5,
      "explanation": "brief explanation of what this exact line does right now",
      "variables": {
        "i": 0,
        "sum": 0
      }
    }
  ],
  "output": "the final return value or printed output of the code"
}

[LANGUAGE]
${language}

[SOURCE CODE TO TRACE]
${code}

[SAMPLE INPUT]
${input ? input : '(none provided — use a small reasonable default and note it in step 1)'}
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
      explanation: s.explanation || `Executing line ${s.line || index + 1}`,
      variables: s.variables || {},
      callStack: Array.isArray(s.callStack) ? s.callStack : ['Solution::solve()']
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
