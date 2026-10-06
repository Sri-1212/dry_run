# DryRun

DryRun traces your LeetCode C++ code line by line so you can inspect how each testcase changes variables and output.

## How It Works

DryRun reads the code from LeetCode's Monaco editor, loads the problem's sample testcases, and sends the selected code and input to Gemini from the extension service worker. Gemini returns a structured trace, which DryRun validates and displays in an interactive step player.

DryRun traces code and never gives solutions. It does not provide hints, fixes, optimal approaches, complexity analysis, or correctness judgments. Bugs are traced as written.

## Scope

- Platform: LeetCode problem pages
- Language: C++
- Traces: Up to 30 validated steps, with repetitive loop iterations merged

## Install

1. Copy `config.example.js` to `config.js` in the project folder.
2. Add your Gemini API key to `GEMINI_API_KEY` in `config.js`. Keep this file private; it is excluded by `.gitignore`.
3. Open `chrome://extensions` and turn on **Developer mode**.
4. Choose **Load unpacked** and select the DryRun project folder.
5. Open a LeetCode C++ problem, open the DryRun extension, click **Read Editor**, select an example, then click **Run**.

## Attribution

DryRun was built entirely by voice using Wispr Flow.