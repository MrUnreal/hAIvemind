<template>
  <div class="prompt-container">
    <div class="prompt-card">
      <h2>What would you like to build?</h2>
      <p class="subtitle">Describe your project and hAIvemind will decompose it into tasks, assign agents, and build it.</p>

      <TemplateGallery @select="onTemplateSelect" />
      <TemplateForm
        v-if="selectedTemplate"
        :template="selectedTemplate"
        @cancel="onTemplateSelect(null)"
        @update:variables="templateVars = $event"
      />

      <div class="textarea-wrapper">
        <textarea
          v-model="prompt"
          placeholder="e.g., Build a REST API with Express and a React frontend for a todo app with user authentication..."
          rows="5"
          @keydown.ctrl.enter="submit"
          @keydown.meta.enter="submit"
          :disabled="planning || !props.connected"
        ></textarea>
      </div>

      <div class="actions">
        <button @click="submit" :disabled="!canSubmit || planning || !props.connected" class="btn-primary">
          {{ planning ? '🔄 Planning...' : '🐝 Build' }}
        </button>
        <span class="hint">Ctrl+Enter to submit</span>
      </div>

      <div class="tier-info">
        <h4>Model Escalation Chain</h4>
        <div class="tiers">
          <div class="tier-step t0">
            <span class="tier-label">T0</span>
            <span class="tier-name">Free</span>
            <span class="tier-cost">0×</span>
          </div>
          <span class="arrow">→</span>
          <div class="tier-step t1">
            <span class="tier-label">T1</span>
            <span class="tier-name">Budget</span>
            <span class="tier-cost">0.33×</span>
          </div>
          <span class="arrow">→</span>
          <div class="tier-step t2">
            <span class="tier-label">T2</span>
            <span class="tier-name">Standard</span>
            <span class="tier-cost">1×</span>
          </div>
          <span class="arrow">→</span>
          <div class="tier-step t3">
            <span class="tier-label">T3</span>
            <span class="tier-name">Premium</span>
            <span class="tier-cost">3×</span>
          </div>
        </div>
        <p class="tier-note">Agents start free. Retries auto-escalate. Cost capped at 3× per task.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { sessionStatus } from '../composables/useSession.js';
import TemplateGallery from './TemplateGallery.vue';
import TemplateForm from './TemplateForm.vue';

const emit = defineEmits(['submit']);
const props = defineProps({
  connected: {
    type: Boolean,
    default: true,
  },
});
const prompt = ref('');
const planning = ref(false);
const selectedTemplate = ref(null);
const templateVars = ref({});

const canSubmit = computed(() => prompt.value.trim() || selectedTemplate.value);

watch(sessionStatus, (status) => {
  planning.value = status === 'planning';
});

function onTemplateSelect(tpl) {
  selectedTemplate.value = tpl;
  templateVars.value = {};
}

function submit() {
  if (!canSubmit.value || planning.value || !props.connected) return;
  planning.value = true;
  const payload = { prompt: prompt.value.trim() };
  if (selectedTemplate.value) {
    payload.templateId = selectedTemplate.value.id;
    payload.variables = { ...templateVars.value };
  }
  emit('submit', payload);
}
</script>

<style scoped>
.prompt-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
}

.prompt-card {
  max-width: 660px;
  width: 100%;
}

h2 {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 8px;
  color: #f0f0f0;
}

.subtitle {
  color: #666;
  margin-bottom: 24px;
  line-height: 1.6;
  font-size: 15px;
}

.textarea-wrapper {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
}

.textarea-wrapper::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 14px;
  padding: 1px;
  background: linear-gradient(135deg, #2a2a3e, #1a1a2e);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  transition: background 0.3s;
}

.textarea-wrapper:focus-within::before {
  background: linear-gradient(135deg, #f5c542, #e6a817);
}

textarea {
  width: 100%;
  background: #0f0f16;
  border: none;
  border-radius: 14px;
  padding: 18px 20px;
  color: #e0e0e0;
  font-size: 15px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  line-height: 1.6;
}
textarea::placeholder {
  color: #3a3a4a;
}
textarea:disabled {
  opacity: 0.5;
}

.actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 18px;
}

.btn-primary {
  background: linear-gradient(135deg, #f5c542, #e6a817);
  color: #111;
  border: none;
  padding: 12px 32px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.2s;
  letter-spacing: 0.01em;
}
.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(245, 197, 66, 0.35);
}
.btn-primary:active:not(:disabled) {
  transform: translateY(0);
}
.btn-primary:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.hint {
  font-size: 12px;
  color: #444;
}

/* ── Tier info ── */
.tier-info {
  margin-top: 40px;
  padding: 18px 20px;
  background: #0f0f16;
  border: 1px solid #1a1a2e;
  border-radius: 14px;
}

.tier-info h4 {
  font-size: 12px;
  font-weight: 600;
  color: #555;
  margin-bottom: 14px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tiers {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.tier-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 14px;
  border-radius: 10px;
  min-width: 70px;
}

.tier-step .tier-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
}
.tier-step .tier-name {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.7;
}
.tier-step .tier-cost {
  font-size: 10px;
  font-weight: 600;
  opacity: 0.5;
}

.tier-step.t0 { background: #0e1f0e; color: #6ecf6e; }
.tier-step.t1 { background: #1f1f0e; color: #c5c56a; }
.tier-step.t2 { background: #0e1a2a; color: #6aacf5; }
.tier-step.t3 { background: #1f0e2a; color: #b56af5; }

.arrow {
  color: #333;
  font-size: 14px;
  flex-shrink: 0;
}

.tier-note {
  margin-top: 12px;
  font-size: 12px;
  color: #444;
  line-height: 1.4;
}
</style>
