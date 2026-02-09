import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * hAIvemind Plugin Manager — Phase 5.7
 *
 * Scans a plugins/ directory, validates plugin interfaces, and provides
 * lifecycle hook execution with emit (fire-and-forget) and pipe (pipeline) modes.
 */
export default class PluginManager {
  /**
   * @param {object} opts
   * @param {string} opts.pluginsDir - Absolute path to plugins directory
   * @param {object} opts.config - Server config (read-only)
   * @param {Function} opts.broadcast - WS broadcast function
   * @param {Function} opts.makeMsg - Protocol message builder
   * @param {object} opts.workspace - WorkspaceManager instance
   */
  constructor({ pluginsDir, config, broadcast, makeMsg, workspace }) {
    this.pluginsDir = pluginsDir;
    this.config = config;
    this.broadcast = broadcast;
    this.makeMsg = makeMsg;
    this.workspace = workspace;

    /** @type {Map<string, PluginEntry>} */
    this.plugins = new Map();

    /** @type {string} - path to plugin state file */
    this.stateFile = join(pluginsDir, '..', '.haivemind', 'plugin-state.json');
  }

  /**
   * Scan pluginsDir and load all plugin subdirectories.
   * Called once at server startup.
   */
  async loadAll() {
    if (!existsSync(this.pluginsDir)) {
      console.log('[plugins] No plugins/ directory found — skipping');
      return;
    }

    const entries = await readdir(this.pluginsDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());

    for (const dir of dirs) {
      try {
        await this.load(dir.name);
      } catch (err) {
        console.warn(`[plugins] Failed to load plugin "${dir.name}": ${err.message}`);
      }
    }

    const enabled = [...this.plugins.values()].filter(p => p.enabled).length;
    console.log(`[plugins] Loaded ${this.plugins.size} plugin(s), ${enabled} enabled`);
  }

  /**
   * Load a single plugin by directory name.
   * @param {string} name - Plugin subdirectory name
   */
  async load(name) {
    const pluginDir = join(this.pluginsDir, name);
    const indexPath = join(pluginDir, 'index.js');

    if (!existsSync(indexPath)) {
      throw new Error(`No index.js found in ${pluginDir}`);
    }

    // Dynamic import with cache-busting for reloads
    const mod = await import(`file://${indexPath}?t=${Date.now()}`);
    const plugin = mod.default;

    // Validate required fields
    if (!plugin || typeof plugin !== 'object') {
      throw new Error('Plugin must export a default object');
    }
    if (!plugin.name || typeof plugin.name !== 'string') {
      throw new Error('Plugin must have a "name" string property');
    }
    if (!plugin.version || typeof plugin.version !== 'string') {
      throw new Error('Plugin must have a "version" string property');
    }

    // Create plugin context
    const ctx = this._createContext(plugin.name);

    // Call init if present
    if (typeof plugin.init === 'function') {
      await plugin.init(ctx);
    }

    // Load state
    const state = await this._loadState();
    const savedState = state[plugin.name];
    const enabled = savedState?.enabled !== false; // default enabled

    /** @type {PluginEntry} */
    const entry = {
      name: plugin.name,
      version: plugin.version,
      description: plugin.description || '',
      hooks: plugin.hooks || {},
      destroy: plugin.destroy,
      enabled,
      loadedAt: Date.now(),
      ctx,
    };

    this.plugins.set(plugin.name, entry);

    // Persist state
    await this._savePluginState(plugin.name, { enabled, loadedAt: entry.loadedAt });

    console.log(`[plugins] ✓ ${plugin.name}@${plugin.version}${enabled ? '' : ' (disabled)'}`);
    return entry;
  }

  /**
   * Unload a plugin (calls destroy, removes from map).
   * @param {string} name
   */
  async unload(name) {
    const entry = this.plugins.get(name);
    if (!entry) throw new Error(`Plugin "${name}" not found`);

    if (typeof entry.destroy === 'function') {
      try { await entry.destroy(); } catch (err) {
        console.warn(`[plugins] ${name} destroy error: ${err.message}`);
      }
    }

    this.plugins.delete(name);
  }

  /**
   * Enable a plugin.
   * @param {string} name
   */
  async enable(name) {
    const entry = this.plugins.get(name);
    if (!entry) throw new Error(`Plugin "${name}" not found`);
    entry.enabled = true;
    await this._savePluginState(name, { enabled: true });
  }

  /**
   * Disable a plugin.
   * @param {string} name
   */
  async disable(name) {
    const entry = this.plugins.get(name);
    if (!entry) throw new Error(`Plugin "${name}" not found`);
    entry.enabled = false;
    await this._savePluginState(name, { enabled: false, disabledAt: Date.now() });
  }

  /**
   * Reload a plugin (unload + re-load).
   * @param {string} name
   */
  async reload(name) {
    if (this.plugins.has(name)) {
      await this.unload(name);
    }
    return this.load(name);
  }

  /**
   * Fire a hook across all enabled plugins. Errors are logged, not thrown.
   * @param {string} hookName
   * @param {object} context
   */
  async emit(hookName, context = {}) {
    for (const entry of this.plugins.values()) {
      if (!entry.enabled) continue;
      const hook = entry.hooks?.[hookName];
      if (typeof hook !== 'function') continue;
      try {
        await hook(context);
      } catch (err) {
        console.warn(`[plugin:${entry.name}] ${hookName} error: ${err.message}`);
      }
    }
  }

  /**
   * Pipeline hook — threads a value through all enabled plugins.
   * Plugins that return undefined pass the value through unchanged.
   * @param {string} hookName
   * @param {*} value - The value to thread through
   * @param {object} context - Additional context
   * @returns {Promise<*>} The final value
   */
  async pipe(hookName, value, context = {}) {
    for (const entry of this.plugins.values()) {
      if (!entry.enabled) continue;
      const hook = entry.hooks?.[hookName];
      if (typeof hook !== 'function') continue;
      try {
        const result = await hook({ ...context, value });
        if (result !== undefined) value = result;
      } catch (err) {
        console.warn(`[plugin:${entry.name}] ${hookName} error: ${err.message}`);
      }
    }
    return value;
  }

  /**
   * List all plugins with their status.
   * @returns {Array<{name: string, version: string, description: string, enabled: boolean, loadedAt: number}>}
   */
  list() {
    return [...this.plugins.values()].map(e => ({
      name: e.name,
      version: e.version,
      description: e.description,
      enabled: e.enabled,
      loadedAt: e.loadedAt,
    }));
  }

  /**
   * Create a sandboxed context for a plugin.
   * @param {string} pluginName
   * @returns {object}
   */
  _createContext(pluginName) {
    return {
      broadcast: this.broadcast,
      makeMsg: this.makeMsg,
      config: Object.freeze({ ...this.config }),
      workspace: this.workspace,
      log: (level, msg) => console.log(`[plugin:${pluginName}] [${level}] ${msg}`),
      store: new Map(),
    };
  }

  /**
   * Load persisted plugin state from disk.
   * @returns {Promise<object>}
   */
  async _loadState() {
    try {
      if (existsSync(this.stateFile)) {
        const raw = await readFile(this.stateFile, 'utf8');
        return JSON.parse(raw);
      }
    } catch { /* ignore */ }
    return {};
  }

  /**
   * Save plugin state to disk.
   * @param {string} name
   * @param {object} partial
   */
  async _savePluginState(name, partial) {
    try {
      const state = await this._loadState();
      state[name] = { ...(state[name] || {}), ...partial };
      const dir = join(this.stateFile, '..');
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await writeFile(this.stateFile, JSON.stringify(state, null, 2));
    } catch (err) {
      console.warn(`[plugins] Failed to save state: ${err.message}`);
    }
  }
}

/**
 * @typedef {object} PluginEntry
 * @property {string} name
 * @property {string} version
 * @property {string} description
 * @property {object} hooks
 * @property {Function} [destroy]
 * @property {boolean} enabled
 * @property {number} loadedAt
 * @property {object} ctx
 */
