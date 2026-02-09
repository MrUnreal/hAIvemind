/**
 * Test plugin for Phase 5.7 plugin system verification.
 * Records hook calls for test assertions.
 */
const calls = [];

export default {
  name: 'test-plugin',
  version: '0.1.0',
  description: 'Plugin system test fixture',

  async init(ctx) {
    this._ctx = ctx;
    calls.push({ hook: 'init', time: Date.now() });
    ctx.log('info', 'Test plugin initialized');
  },

  hooks: {
    beforeSession: async (ctx) => {
      calls.push({ hook: 'beforeSession', ...ctx });
    },
    afterSession: async (ctx) => {
      calls.push({ hook: 'afterSession', ...ctx });
    },
    afterPlan: async ({ value, ...ctx }) => {
      calls.push({ hook: 'afterPlan', ...ctx });
      return value; // pass through unchanged
    },
    onShutdown: async () => {
      calls.push({ hook: 'onShutdown', time: Date.now() });
    },
  },

  async destroy() {
    calls.push({ hook: 'destroy', time: Date.now() });
  },
};

// Export calls for test inspection
export { calls };
