// Settings management for ChatGPT Wrangler
class Settings {
  constructor() {
    this.storage = window.localStorage;
    this.defaults = {
      chimesEnabled: true
    };
  }

  get(key) {
    try {
      const value = this.storage.getItem(`chatgpt-wrangler-${key}`);
      if (value === null) {
        return this.defaults[key];
      }
      return JSON.parse(value);
    } catch (e) {
      console.warn(`Settings: Error reading ${key}:`, e);
      return this.defaults[key];
    }
  }

  set(key, value) {
    try {
      this.storage.setItem(`chatgpt-wrangler-${key}`, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn(`Settings: Error writing ${key}:`, e);
      return false;
    }
  }

  getChimesEnabled() {
    return this.get('chimesEnabled');
  }

  setChimesEnabled(enabled) {
    return this.set('chimesEnabled', enabled);
  }

  toggle(key) {
    const currentValue = this.get(key);
    const newValue = !currentValue;
    this.set(key, newValue);
    return newValue;
  }

  toggleChimes() {
    return this.toggle('chimesEnabled');
  }
}

// Make Settings available globally
if (typeof window !== "undefined") {
  window.Settings = Settings;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = Settings;
}