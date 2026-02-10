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

    <div class="task-preview">
      <div class="task-preview-title">Tasks ({{ template.tasks?.length || 0 }})</div>
      <div v-for="t in template.tasks" :key="t.id" class="task-item">
        <span class="task-dot">●</span>
        <span>{{ t.label }}</span>
      </div>
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
  background: #111118;
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
  color: #666;
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
  color: #888;
  margin-bottom: 4px;
}

.field-input {
  width: 100%;
  padding: 8px 12px;
  background: #0a0a10;
  border: 1px solid #333;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 13px;
  outline: none;
}
.field-input:focus {
  border-color: #f5c542;
}

.task-preview-title {
  font-size: 12px;
  color: #666;
  margin-bottom: 6px;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #aaa;
  padding: 2px 0;
}

.task-dot {
  font-size: 8px;
  color: #f5c542;
}
</style>
