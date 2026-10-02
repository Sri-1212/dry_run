/**
 * Storage Utility for Dry Run Chrome Extension
 * Encapsulates chrome.storage APIs with local fallbacks for development.
 */

export const DEFAULT_SETTINGS = {
  apiKey: '',
  apiProvider: 'gemini', // 'gemini' | 'openai' | 'interpreter'
  modelName: 'gemini-1.5-pro',
  theme: 'dark-dragon',
  stepSpeedMs: 800,
  autoTrace: true,
  showMemoryGraph: true,
  maxSteps: 50,
  cppStandard: 'c++20'
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

  /**
   * Save execution history / cache
   */
  static async saveCache(problemSlug, code, input, steps) {
    const key = `cache_${problemSlug}_${this.hashCode(code + input)}`;
    const cacheData = { timestamp: Date.now(), steps };
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: cacheData });
    }
  }

  static hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }
}
