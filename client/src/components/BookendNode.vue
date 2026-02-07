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
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.bookend-node.start {
  background: #1a2a1a;
  border: 2px solid #2a5a2a;
  color: #6ecf6e;
}

.bookend-node.end {
  background: #1a1a2e;
  border: 2px solid #3a3a6a;
  color: #8a8af5;
}

.bookend-node.complete {
  background: #1a3a1a;
  border: 2px solid #2a5a2a;
  color: #6ecf6e;
}

.bookend-node.failed {
  background: #3a1a1a;
  border: 2px solid #5a2a2a;
  color: #f56a6a;
}

.bookend-label {
  pointer-events: none;
}
</style>
