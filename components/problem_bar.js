/**
 * Problem Bar Component
 * Displays current problem title, language indicator, and sync controls.
 */

export class ProblemBarComponent {
  constructor(titleEl) {
    this.titleEl = titleEl;
  }

  setProblem(title) {
    if (this.titleEl) {
      this.titleEl.textContent = title || 'LeetCode C++ Problem';
    }
  }
}
