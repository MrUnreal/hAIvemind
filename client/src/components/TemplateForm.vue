<template>
  <div class="template-form" v-if="template">
    <div class="form-header">
      <span class="form-badge">{{ template.name }}</span>
      <button class="btn-clear" @click="$emit('cancel')">✕</button>
    </div>

    <div v-if="template.variables?.length" class="form-fields">
      <div v-for="v in template.variables" :key="v.name" class="field">
        <label :for="'tpl-' + v.name">{{ v.label }}</label>
        <input
          :id="'tpl-' + v.name"
          v-model="values[v.name]"
          :placeholder="v.default || ''"
          class="field-input"
        />
      </div>
    </div>

    <!-- File-based templates: show tasks -->
    <div v-if="template.tasks?.length" class="task-preview">
      <div class="task-preview-title">Tasks ({{ template.tasks.length }})</div>
      <div v-for="t in template.tasks" :key="t.id" class="task-item">
        <span class="task-dot">●</span>
        <span>{{ t.label }}</span>
      </div>
    </div>

    <!-- Project templates: show starter prompts as build phases -->
    <div v-else-if="template.starterPrompts?.length" class="task-preview">
      <div class="task-preview-title">Build Phases ({{ template.starterPrompts.length }})</div>
      <div v-for="(p, i) in template.starterPrompts" :key="i" class="task-item">
        <span class="task-dot">{{ i + 1 }}</span>
        <span>{{ p }}</span>
      </div>
    </div>

    <div v-else class="task-preview">
      <div class="task-preview-title">No predefined tasks</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  template: { type: Object, default: null },
});
const emit = defineEmits(['cancel', 'update:variables']);

const values = ref({});

watch(() => props.template, (tpl) => {
  if (!tpl) { values.value = {}; return; }
  const v = {};
  for (const variable of tpl.variables || []) {
    v[variable.name] = variable.default || '';
  }
  values.value = v;
}, { immediate: true });

watch(values, (v) => emit('update:variables', { ...v }), { deep: true });
</script>

<style scoped>
.template-form {
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid #f5c54266;
  border-radius: 10px;
  margin-bottom: 16px;
}

.form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.form-badge {
  padding: 4px 10px;
  background: #2a1a0a;
  color: #f5c542;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.btn-clear {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 16px;
  padding: 2px 6px;
}
.btn-clear:hover { color: #f66; }

.form-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.field label {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.field-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}
.field-input:focus {
  border-color: #f5c542;
}

.task-preview-title {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 6px;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 2px 0;
}

.task-dot {
  font-size: 10px;
  color: #f5c542;
  min-width: 12px;
  text-align: center;
}
</style>
