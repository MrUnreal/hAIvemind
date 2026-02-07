<template>
  <div class="prompt-node" :title="data.prompt">
    <Handle type="target" :position="Position.Left" />
    <div class="prompt-icon">💬</div>
    <div class="prompt-text">{{ data.label }}</div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<script setup>
import { Handle, Position } from '@vue-flow/core';

defineProps({
  data: { type: Object, required: true },
});
</script>

<style scoped>
.prompt-node {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1a1a2e;
  border: 2px solid #f5c542;
  border-radius: 12px;
  padding: 10px 14px;
  min-width: 120px;
  max-width: 220px;
  cursor: default;
}

.prompt-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.prompt-text {
  font-size: 11px;
  font-weight: 500;
  color: #e0e0e0;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}
</style>
