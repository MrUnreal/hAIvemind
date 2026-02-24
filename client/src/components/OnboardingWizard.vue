<template>
  <div v-if="visible" class="onboarding-overlay">
    <div class="onboarding-card">
      <div class="onboarding-header">
        <h2 class="onboarding-title">🐝 Welcome to hAIvemind</h2>
        <p class="onboarding-subtitle">Get started in 3 quick steps</p>
        <div class="step-indicators">
          <span v-for="s in totalSteps" :key="s" :class="['step-dot', { active: s === step, done: s < step }]">
            {{ s < step ? '✓' : s }}
          </span>
        </div>
      </div>

      <!-- Step 1: Project name + description -->
      <div v-if="step === 1" class="step-content">
        <h3 class="step-title">Create your first project</h3>
        <p class="step-desc">A project groups sessions, skills, and configuration for one codebase.</p>
        <div class="field-group">
          <label class="field-label">Project Name</label>
          <input
            v-model="projectName"
            class="field-input"
            placeholder="my-awesome-app"
            @keyup.enter="nextStep"
            ref="nameInput"
          />
        </div>
        <div class="field-group">
          <label class="field-label">Description <span class="optional">(optional)</span></label>
          <input
            v-model="projectDesc"
            class="field-input"
            placeholder="A brief description of your project"
          />
        </div>
        <p v-if="nameError" class="field-error">{{ nameError }}</p>
      </div>

      <!-- Step 2: Backend selection -->
      <div v-if="step === 2" class="step-content">
        <h3 class="step-title">Choose your AI backend</h3>
        <p class="step-desc">Pick how hAIvemind connects to language models.</p>
        <div class="backend-cards">
          <div
            :class="['backend-option', { selected: selectedBackend === 'copilot' }]"
            @click="selectedBackend = 'copilot'"
          >
            <span class="backend-icon">🤖</span>
            <span class="backend-name">GitHub Copilot</span>
            <span class="backend-detail">Uses VS Code Copilot extension — no API keys needed</span>
          </div>
          <div
            :class="['backend-option', { selected: selectedBackend === 'ollama' }]"
            @click="selectedBackend = 'ollama'"
          >
            <span class="backend-icon">🦙</span>
            <span class="backend-name">Ollama</span>
            <span class="backend-detail">Local models — fully private, runs on your machine</span>
          </div>
        </div>
      </div>

      <!-- Step 3: Escalation preset + guided tips -->
      <div v-if="step === 3" class="step-content">
        <h3 class="step-title">Choose an escalation strategy</h3>
        <p class="step-desc">Controls how hAIvemind tiers up to more powerful (and costlier) models.</p>
        <div class="preset-cards">
          <div
            v-for="preset in presets"
            :key="preset.id"
            :class="['preset-option', { selected: selectedPreset === preset.id }]"
            @click="selectedPreset = preset.id"
          >
            <span class="preset-icon">{{ preset.icon }}</span>
            <div class="preset-info">
              <span class="preset-name">{{ preset.name }}</span>
              <span class="preset-detail">{{ preset.desc }}</span>
              <span class="preset-chain">{{ preset.chain.join(' → ') }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Navigation -->
      <div class="onboarding-footer">
        <button v-if="step > 1" class="onboarding-btn secondary" @click="step--">← Back</button>
        <div v-else class="spacer"></div>
        <div class="footer-right">
          <button class="onboarding-btn skip" @click="$emit('skip')">Skip setup</button>
          <button v-if="step < totalSteps" class="onboarding-btn primary" @click="nextStep" :disabled="step === 1 && !projectName.trim()">
            Next →
          </button>
          <button v-else class="onboarding-btn primary finish" @click="onFinish" :disabled="creating">
            {{ creating ? 'Creating…' : '🚀 Launch Project' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
});

const emit = defineEmits(['complete', 'skip']);

const totalSteps = 3;
const step = ref(1);
const projectName = ref('');
const projectDesc = ref('');
const nameError = ref('');
const selectedBackend = ref('copilot');
const selectedPreset = ref('balanced');
const creating = ref(false);
const nameInput = ref(null);

const presets = [
  {
    id: 'frugal',
    icon: '💰',
    name: 'Frugal',
    desc: 'Maximize free models — only escalate when stuck',
    chain: ['T0', 'T0', 'T0', 'T1', 'T2'],
  },
  {
    id: 'balanced',
    icon: '⚖️',
    name: 'Balanced',
    desc: 'Default tier progression — good quality, reasonable cost',
    chain: ['T0', 'T0', 'T1', 'T2', 'T3'],
  },
  {
    id: 'quality',
    icon: '🏆',
    name: 'Quality First',
    desc: 'Start with better models — faster results, higher cost',
    chain: ['T1', 'T1', 'T2', 'T3', 'T3'],
  },
];

function nextStep() {
  if (step.value === 1) {
    const name = projectName.value.trim();
    if (!name) {
      nameError.value = 'Project name is required';
      return;
    }
    nameError.value = '';
  }
  if (step.value < totalSteps) {
    step.value++;
  }
}

async function onFinish() {
  creating.value = true;
  const preset = presets.find(p => p.id === selectedPreset.value);
  emit('complete', {
    name: projectName.value.trim(),
    description: projectDesc.value.trim(),
    backend: selectedBackend.value,
    escalation: preset?.chain ?? ['T0', 'T0', 'T1', 'T2', 'T3'],
  });
}
</script>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-overlay);
  backdrop-filter: blur(6px);
}

.onboarding-card {
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 16px;
  padding: 32px;
  max-width: 560px;
  width: calc(100% - 48px);
  box-shadow: var(--shadow-lg);
}

.onboarding-header {
  text-align: center;
  margin-bottom: 24px;
}

.onboarding-title {
  font-size: 22px;
  font-weight: 700;
  background: linear-gradient(135deg, #f5c542, #ffd866);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0 0 4px;
}

.onboarding-subtitle {
  color: var(--text-secondary);
  font-size: 14px;
  margin: 0 0 16px;
}

.step-indicators {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.step-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--bg-input);
  border: 2px solid var(--border-secondary);
  color: var(--text-tertiary);
  transition: all 0.2s;
}
.step-dot.active {
  border-color: var(--accent-gold);
  color: var(--accent-gold);
  background: var(--accent-gold-dim);
}
.step-dot.done {
  border-color: var(--accent-green);
  color: var(--accent-green);
  background: var(--accent-green-dim);
}

.step-content {
  min-height: 200px;
}

.step-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.step-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 16px;
}

.field-group {
  margin-bottom: 14px;
}

.field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.optional {
  font-weight: 400;
  text-transform: none;
  color: var(--text-tertiary);
}

.field-input {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}
.field-input:focus {
  border-color: var(--accent-gold);
}

.field-error {
  color: var(--status-error);
  font-size: 12px;
  margin: 6px 0 0;
}

.backend-cards, .preset-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.backend-option, .preset-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-input);
  border: 2px solid var(--border-secondary);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.backend-option:hover, .preset-option:hover {
  background: var(--bg-hover);
}
.backend-option.selected, .preset-option.selected {
  border-color: var(--accent-gold);
  background: var(--accent-gold-dim);
}

.backend-icon, .preset-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.backend-name, .preset-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.backend-detail, .preset-detail {
  font-size: 12px;
  color: var(--text-secondary);
}

.preset-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.preset-chain {
  font-size: 11px;
  color: var(--accent-gold);
  font-family: monospace;
  margin-top: 2px;
}

.onboarding-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-secondary);
}

.footer-right {
  display: flex;
  gap: 8px;
}

.spacer { flex: 1; }

.onboarding-btn {
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
}
.onboarding-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.onboarding-btn.primary {
  background: var(--accent-gold);
  color: var(--bg-secondary);
  border-color: var(--accent-gold);
}
.onboarding-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.onboarding-btn.secondary {
  background: var(--btn-bg);
  border-color: var(--btn-border);
  color: var(--btn-text);
}
.onboarding-btn.secondary:hover {
  background: var(--btn-hover-bg);
}

.onboarding-btn.skip {
  background: transparent;
  color: var(--text-tertiary);
  font-weight: 400;
}
.onboarding-btn.skip:hover {
  color: var(--text-secondary);
}
</style>
