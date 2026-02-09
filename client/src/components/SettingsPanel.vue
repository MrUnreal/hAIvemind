<template>
  <div class="settings-panel">
    <div class="panel-header">
      <h3>⚙️ Project Settings</h3>
      <button class="close-btn" @click="$emit('close')" title="Close">×</button>
    </div>

    <div class="panel-body" v-if="!loading">
      <!-- Tabs -->
      <div class="tab-bar">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="['tab-btn', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          {{ tab.icon }} {{ tab.label }}
        </button>
      </div>

      <!-- Escalation tab -->
      <div v-if="activeTab === 'escalation'" class="tab-content">
        <p class="section-hint">
          Customize the model escalation chain for this project.
          Null values use global defaults.
        </p>

        <div class="setting-row">
          <label>Escalation Chain</label>
          <div class="chain-editor">
            <div
              v-for="(tier, i) in localEscalation"
              :key="i"
              class="chain-step"
            >
              <span class="step-index">#{{ i }}</span>
              <select v-model="localEscalation[i]" class="tier-select">
                <option value="T0">T0 — Free</option>
                <option value="T1">T1 — Budget</option>
                <option value="T2">T2 — Standard</option>
                <option value="T3">T3 — Premium</option>
              </select>
              <button
                v-if="localEscalation.length > 1"
                class="remove-step"
                @click="localEscalation.splice(i, 1)"
                title="Remove"
              >×</button>
            </div>
            <button class="add-step-btn" @click="localEscalation.push('T0')">+ Add Step</button>
          </div>
        </div>

        <div class="setting-row">
          <label>Max Retries</label>
          <input
            type="number"
            v-model.number="localMaxRetries"
            min="1"
            max="10"
            class="number-input"
            placeholder="5 (default)"
          />
        </div>

        <div class="setting-row">
          <label>Max Concurrency</label>
          <input
            type="number"
            v-model.number="localMaxConcurrency"
            min="1"
            max="10"
            class="number-input"
            placeholder="3 (default)"
          />
        </div>

        <div class="setting-row">
          <label>Cost Ceiling</label>
          <input
            type="number"
            v-model.number="localCostCeiling"
            min="0"
            step="0.5"
            class="number-input"
            placeholder="No limit"
          />
          <span class="input-hint">Max premium requests per session</span>
        </div>

        <div class="action-row">
          <button class="save-btn" @click="saveEscalation" :disabled="saving">
            {{ saving ? 'Saving...' : 'Save Escalation Settings' }}
          </button>
          <button class="reset-btn" @click="resetEscalation">Reset to Defaults</button>
        </div>
      </div>

      <!-- Skills tab -->
      <div v-if="activeTab === 'skills'" class="tab-content">
        <p class="section-hint">
          Learned commands from previous sessions. These are injected into agent prompts.
        </p>

        <div v-for="category in skillCategories" :key="category.key" class="skill-category">
          <h4>{{ category.icon }} {{ category.label }}</h4>
          <div v-if="localSkills[category.key]?.length" class="skill-list">
            <div v-for="(cmd, i) in localSkills[category.key]" :key="i" class="skill-chip">
              <code>{{ cmd }}</code>
              <button class="chip-remove" @click="removeSkill(category.key, i)">×</button>
            </div>
          </div>
          <span v-else class="empty-hint">No commands discovered yet</span>
          <div class="add-skill">
            <input
              type="text"
              v-model="newSkillInputs[category.key]"
              :placeholder="`Add ${category.label.toLowerCase()} command...`"
              @keyup.enter="addSkill(category.key)"
              class="skill-input"
            />
            <button class="add-btn" @click="addSkill(category.key)">+</button>
          </div>
        </div>

        <div class="skill-category">
          <h4>📝 Patterns</h4>
          <div v-if="localSkills.patterns?.length" class="skill-list">
            <div v-for="(pat, i) in localSkills.patterns" :key="i" class="skill-chip pattern-chip">
              {{ pat }}
              <button class="chip-remove" @click="removeSkill('patterns', i)">×</button>
            </div>
          </div>
          <span v-else class="empty-hint">No patterns discovered yet</span>
          <div class="add-skill">
            <input
              type="text"
              v-model="newSkillInputs.patterns"
              placeholder="Add pattern..."
              @keyup.enter="addSkill('patterns')"
              class="skill-input"
            />
            <button class="add-btn" @click="addSkill('patterns')">+</button>
          </div>
        </div>

        <div class="action-row">
          <button class="save-btn" @click="saveSkills" :disabled="saving">
            {{ saving ? 'Saving...' : 'Save Skills' }}
          </button>
        </div>
      </div>
    </div>

    <div v-else class="loading-state">Loading settings...</div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue';
import { activeProject } from '../composables/useProjects.js';
import {
  projectSettings,
  projectSkills,
  fetchSettings,
  fetchSkills,
  updateSettings,
  updateSkills,
} from '../composables/useProjectSettings.js';

const emit = defineEmits(['close']);

const loading = ref(false);
const saving = ref(false);
const activeTab = ref('escalation');

const tabs = [
  { id: 'escalation', label: 'Escalation', icon: '🎛️' },
  { id: 'skills', label: 'Skills', icon: '🧠' },
];

// ── Escalation state ──
const defaultChain = ['T0', 'T0', 'T1', 'T2', 'T3'];
const localEscalation = ref([...defaultChain]);
const localMaxRetries = ref(null);
const localMaxConcurrency = ref(null);
const localCostCeiling = ref(null);

// ── Skills state ──
const localSkills = reactive({
  buildCommands: [],
  testCommands: [],
  lintCommands: [],
  deployCommands: [],
  patterns: [],
});
const newSkillInputs = reactive({
  buildCommands: '',
  testCommands: '',
  lintCommands: '',
  deployCommands: '',
  patterns: '',
});

const skillCategories = [
  { key: 'buildCommands', label: 'Build Commands', icon: '🔨' },
  { key: 'testCommands', label: 'Test Commands', icon: '🧪' },
  { key: 'lintCommands', label: 'Lint Commands', icon: '🔍' },
  { key: 'deployCommands', label: 'Deploy Commands', icon: '🚀' },
];

// ── Watchers ──
watch(projectSettings, (s) => {
  if (s) {
    localEscalation.value = s.escalation ? [...s.escalation] : [...defaultChain];
    localMaxRetries.value = s.maxRetriesTotal;
    localMaxConcurrency.value = s.maxConcurrency;
    localCostCeiling.value = s.costCeiling;
  }
}, { immediate: true });

watch(projectSkills, (s) => {
  if (s) {
    localSkills.buildCommands = [...(s.buildCommands || [])];
    localSkills.testCommands = [...(s.testCommands || [])];
    localSkills.lintCommands = [...(s.lintCommands || [])];
    localSkills.deployCommands = [...(s.deployCommands || [])];
    localSkills.patterns = [...(s.patterns || [])];
  }
}, { immediate: true });

// ── Actions ──
async function saveEscalation() {
  if (!activeProject.value) return;
  saving.value = true;
  try {
    await updateSettings(activeProject.value.slug, {
      escalation: localEscalation.value,
      maxRetriesTotal: localMaxRetries.value,
      maxConcurrency: localMaxConcurrency.value,
      costCeiling: localCostCeiling.value,
    });
  } finally {
    saving.value = false;
  }
}

function resetEscalation() {
  localEscalation.value = [...defaultChain];
  localMaxRetries.value = null;
  localMaxConcurrency.value = null;
  localCostCeiling.value = null;
}

function addSkill(key) {
  const val = newSkillInputs[key]?.trim();
  if (!val) return;
  if (!localSkills[key].includes(val)) {
    localSkills[key].push(val);
  }
  newSkillInputs[key] = '';
}

function removeSkill(key, index) {
  localSkills[key].splice(index, 1);
}

async function saveSkills() {
  if (!activeProject.value) return;
  saving.value = true;
  try {
    await updateSkills(activeProject.value.slug, { ...localSkills });
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  if (activeProject.value?.slug) {
    loading.value = true;
    await Promise.all([
      fetchSettings(activeProject.value.slug),
      fetchSkills(activeProject.value.slug),
    ]);
    loading.value = false;
  }
});
</script>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0a0a0f;
  color: #c0c0c0;
  font-size: 13px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #2a2a3e;
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  color: #e0e0e0;
}

.close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.close-btn:hover {
  background: #2a2a3e;
  color: #fff;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.tab-bar {
  display: flex;
  border-bottom: 1px solid #2a2a3e;
  padding: 0 12px;
}

.tab-btn {
  background: none;
  border: none;
  color: #666;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 12px;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}
.tab-btn:hover {
  color: #aaa;
}
.tab-btn.active {
  color: #4a9eff;
  border-bottom-color: #4a9eff;
}

.tab-content {
  padding: 16px;
}

.section-hint {
  color: #555;
  font-size: 12px;
  margin: 0 0 16px;
  line-height: 1.5;
}

.setting-row {
  margin-bottom: 16px;
}

.setting-row label {
  display: block;
  color: #888;
  font-size: 11px;
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 6px;
}

.chain-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chain-step {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-index {
  color: #555;
  font-size: 11px;
  width: 20px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.tier-select {
  background: #16161e;
  border: 1px solid #2a2a3e;
  color: #c0c0c0;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  flex: 1;
}

.remove-step {
  background: none;
  border: none;
  color: #f44336;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
}

.add-step-btn {
  background: #1a1a2e;
  border: 1px dashed #2a2a3e;
  color: #4a9eff;
  padding: 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.add-step-btn:hover {
  border-color: #4a9eff;
}

.number-input {
  background: #16161e;
  border: 1px solid #2a2a3e;
  color: #c0c0c0;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  width: 100px;
}

.input-hint {
  color: #444;
  font-size: 11px;
  margin-left: 8px;
}

.action-row {
  display: flex;
  gap: 8px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #1a1a2e;
}

.save-btn {
  background: #1a3a6a;
  border: none;
  color: #4a9eff;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.save-btn:hover:not(:disabled) {
  background: #2a4a7a;
}
.save-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.reset-btn {
  background: #1a1a2e;
  border: 1px solid #2a2a3e;
  color: #888;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.reset-btn:hover {
  color: #c0c0c0;
  border-color: #444;
}

/* ── Skills tab ── */

.skill-category {
  margin-bottom: 20px;
}

.skill-category h4 {
  color: #aaa;
  font-size: 12px;
  margin: 0 0 8px;
}

.skill-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.skill-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #16161e;
  border: 1px solid #2a2a3e;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
}
.skill-chip code {
  color: #6ecf6e;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
}

.pattern-chip {
  color: #b0b0d0;
}

.chip-remove {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
}
.chip-remove:hover {
  color: #f44336;
}

.empty-hint {
  color: #444;
  font-size: 12px;
  font-style: italic;
}

.add-skill {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.skill-input {
  background: #16161e;
  border: 1px solid #2a2a3e;
  color: #c0c0c0;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  flex: 1;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.add-btn {
  background: #1a3a1a;
  border: 1px solid #2a3a2a;
  color: #6ecf6e;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
.add-btn:hover {
  background: #2a4a2a;
}

.loading-state {
  padding: 32px;
  text-align: center;
  color: #555;
}
</style>
