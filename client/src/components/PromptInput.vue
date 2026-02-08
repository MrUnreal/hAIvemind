<template>
  <div class="prompt-container">
    <div class="prompt-card">
      <h2>What would you like to build?</h2>
      <p class="subtitle">Describe your project and hAIvemind will decompose it into tasks, assign agents, and build it for you.</p>

      <textarea
        v-model="prompt"
        placeholder="e.g., Build a REST API with Express and a React frontend for a todo app with user authentication..."
        rows="5"
        @keydown.ctrl.enter="submit"
        @keydown.meta.enter="submit"
        :disabled="planning || !props.connected"
      ></textarea>

      <div class="actions">
        <button @click="submit" :disabled="!prompt.trim() || planning || !props.connected" class="btn-primary">
          {{ planning ? '🔄 Planning...' : '🐝 Build' }}
        </button>
        <span class="hint">Ctrl+Enter to submit</span>
      </div>

      <div class="tier-info">
        <h4>Model Tiers (Copilot Premium Request Cost)</h4>
        <div class="tiers">
          <span class="tier t0">T0 Free (0×)</span>
          <span class="arrow">→</span>
          <span class="tier t1">T1 Budget (0.33×)</span>
          <span class="arrow">→</span>
          <span class="tier t2">T2 Standard (1×)</span>
          <span class="arrow">→</span>
          <span class="tier t3">T3 Premium (3×)</span>
        </div>
        <p class="tier-note">Workers start at T0 (free). Retries escalate through tiers automatically. Max cost capped at 3×.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { sessionStatus } from '../composables/useSession.js';

const emit = defineEmits(['submit']);
const props = defineProps({
  connected: {
    type: Boolean,
    default: true,
  },
});
const prompt = ref('');
const planning = ref(false);

watch(sessionStatus, (status) => {
  planning.value = status === 'planning';
});

function submit() {
  if (!prompt.value.trim() || planning.value || !props.connected) return;
  planning.value = true;
  emit('submit', prompt.value.trim());
}
</script>

<style scoped>
.prompt-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.prompt-card {
  max-width: 640px;
  width: 100%;
}

h2 {
  font-size: 28px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #f0f0f0;
}

.subtitle {
  color: #888;
  margin-bottom: 24px;
  line-height: 1.5;
}

textarea {
  width: 100%;
  background: #111118;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 16px;
  color: #e0e0e0;
  font-size: 15px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  transition: border-color 0.2s;
}
textarea:focus {
  border-color: #f5c542;
}
textarea:disabled {
  opacity: 0.5;
}

.actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
}

.btn-primary {
  background: #f5c542;
  color: #111;
  border: none;
  padding: 10px 28px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-primary:hover:not(:disabled) {
  background: #ffd866;
}
.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hint {
  font-size: 12px;
  color: #555;
}

.tier-info {
  margin-top: 40px;
  padding: 16px;
  background: #111118;
  border: 1px solid #222;
  border-radius: 12px;
}

.tier-info h4 {
  font-size: 13px;
  font-weight: 500;
  color: #888;
  margin-bottom: 12px;
}

.tiers {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tier {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
}
.tier.t0 { background: #1a3a1a; color: #6ecf6e; }
.tier.t1 { background: #2a2a1a; color: #c5c56a; }
.tier.t2 { background: #1a2a3a; color: #6aacf5; }
.tier.t3 { background: #2a1a3a; color: #b56af5; }
.tier.t4 { background: #3a1a1a; color: #f56a6a; }

.arrow {
  color: #444;
  font-size: 14px;
}

.tier-note {
  margin-top: 10px;
  font-size: 12px;
  color: #555;
}
</style>
