/**
 * Result Panel Component
 * Manages view switching between Idle, Loading, Error, and Result states.
 */

export class ResultPanelComponent {
  constructor(resultAreaEl) {
    this.resultAreaEl = resultAreaEl;
  }

  showState(stateName) {
    const states = ['idle', 'loading', 'error', 'result'];
    states.forEach(s => {
      const el = document.getElementById(`state-${s}`);
      if (el) {
        if (s === stateName) {
          el.classList.add('active');
          el.classList.remove('hidden');
        } else {
          el.classList.remove('active');
          el.classList.add('hidden');
        }
      }
    });
  }
}
