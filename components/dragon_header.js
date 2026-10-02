/**
 * Dragon Header Component
 * Encapsulates header rendering and status indicator updates.
 */

export class DragonHeaderComponent {
  constructor(containerEl) {
    this.container = containerEl;
  }

  updateStatus(isOnline, text = 'Online') {
    const statusDot = this.container.querySelector('.status-dot');
    const statusText = this.container.querySelector('#connection-status');
    if (statusDot && statusText) {
      statusDot.style.background = isOnline ? '#10b981' : '#ef4444';
      statusText.childNodes[1].textContent = ` ${text}`;
    }
  }
}
