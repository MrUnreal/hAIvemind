import CopilotBackend from './copilot.js';
import OllamaBackend from './ollama.js';

export { default as AgentBackend } from './base.js';
export { default as CopilotBackend } from './copilot.js';
export { default as OllamaBackend } from './ollama.js';

/** Registry of available backend classes by name */
const registry = new Map([
  ['copilot', CopilotBackend],
  ['ollama', OllamaBackend],
]);

/**
 * Register a custom backend class.
 * @param {string} name
 * @param {typeof import('./base.js').default} BackendClass
 */
export function registerBackend(name, BackendClass) {
  registry.set(name, BackendClass);
}

/**
 * Instantiate a backend by name.
 * @param {string} name — registered backend name
 * @param {object} [backendConfig] — backend-specific settings
 * @returns {import('./base.js').default}
 */
export function getBackend(name, backendConfig = {}) {
  const BackendClass = registry.get(name);
  if (!BackendClass) {
    throw new Error(`Unknown agent backend: "${name}". Available: ${[...registry.keys()].join(', ')}`);
  }
  return new BackendClass(backendConfig);
}

/**
 * List all registered backend names.
 * @returns {string[]}
 */
export function listBackends() {
  return [...registry.keys()];
}
