/**
 * Settings Panel Component
 * Manages API keys, model parameters, execution providers, and speed controls.
 */

export class SettingsPanelComponent {
  constructor(sectionEl) {
    this.sectionEl = sectionEl;
  }

  toggleVisibility() {
    if (this.sectionEl) {
      this.sectionEl.classList.toggle('hidden');
    }
  }
}
