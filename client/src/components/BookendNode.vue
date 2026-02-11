<template>
  <div :class="['bookend-node', data.variant]">
    <Handle v-if="data.variant === 'end' || data.variant === 'complete' || data.variant === 'failed'" type="target" :position="Position.Left" />
    <span class="bookend-label">{{ displayLabel }}</span>
    <Handle v-if="data.variant === 'start'" type="source" :position="Position.Right" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';

const props = defineProps({
  data: { type: Object, required: true },
});

const displayLabel = computed(() => {
  if (props.data.variant === 'complete') return '✅ DONE';
  if (props.data.variant === 'failed') return '❌ FAIL';
  return props.data.label;
});
</script>

<style scoped>
.bookend-node {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 90px;
  height: 40px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

.bookend-node.start {
  background: #0e1f0e;
  border: 2px solid #1a3a1a;
  color: #6ecf6e;
  box-shadow: 0 0 12px rgba(110, 207, 110, 0.1);
}

.bookend-node.end {
  background: #0e0e1f;
  border: 2px solid #2a2a5a;
  color: #8a8af5;
  box-shadow: 0 0 12px rgba(138, 138, 245, 0.1);
}

.bookend-node.complete {
  background: #0e1f0e;
  border: 2px solid #2a5a2a;
  color: #6ecf6e;
  box-shadow: 0 0 16px rgba(110, 207, 110, 0.2);
}

.bookend-node.failed {
  background: #1f0e0e;
  border: 2px solid #5a2a2a;
  color: #f56a6a;
  box-shadow: 0 0 16px rgba(245, 106, 106, 0.2);
}

.bookend-label {
  pointer-events: none;
}
</style>
