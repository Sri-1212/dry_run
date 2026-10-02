/**
 * Storage Utility for Dry Run Chrome Extension
 * Encapsulates chrome.storage APIs with local fallbacks for development.
 */

export const DEFAULT_SETTINGS = {
  apiProvider: 'gemini', // 'gemini' | 'interpreter'
  modelName: 'gemini-1.5-flash',
  theme: 'dark-dragon',
  stepSpeedMs: 800,
  autoTrace: true,
  showMemoryGraph: true,
  maxSteps: 40
};

export class StorageService {
  /**
   * Save user settings to chrome.storage.sync
   */
  static async saveSettings(settings) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.set(settings, () => resolve(settings));
      } else {
        localStorage.setItem('dryrun_settings', JSON.stringify(settings));
        resolve(settings);
      }
    });
  }

  /**
   * Get user settings with defaults
   */
  static async getSettings() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
          resolve({ ...DEFAULT_SETTINGS, ...items });
        });
      } else {
        const stored = localStorage.getItem('dryrun_settings');
        resolve(stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS);
      }
    });
  }

  /**
   * Save Gemini API key securely in chrome.storage.local
   */
  static async saveGeminiApiKey(key) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ geminiApiKey: key }, () => resolve());
      } else {
        localStorage.setItem('geminiApiKey', key);
        resolve();
      }
    });
  }

  /**
   * Retrieve Gemini API key from chrome.storage.local
   */
  static async getGeminiApiKey() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['geminiApiKey'], (result) => {
          resolve(result.geminiApiKey || '');
        });
      } else {
        resolve(localStorage.getItem('geminiApiKey') || '');
      }
    });
  }

  /**
   * Save last used sample input for a specific problem slug
   */
  static async saveSampleInput(problemSlug, inputData) {
    const key = `sample_input_${problemSlug || 'default'}`;
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: inputData }, resolve);
      } else {
        localStorage.setItem(key, inputData);
        resolve();
      }
    });
  }

  /**
   * Retrieve sample input for a problem slug
   */
  static async getSampleInput(problemSlug) {
    const key = `sample_input_${problemSlug || 'default'}`;
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key] || '');
        });
      } else {
        resolve(localStorage.getItem(key) || '');
      }
    });
  }
}
