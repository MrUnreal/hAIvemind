<template>
  <div :class="['bookend-node', data.variant]">
    <Handle v-if="data.variant === 'end' || data.variant === 'complete' || data.variant === 'failed'" type="target" :position="Position.Left" />

    <!-- Pulsing aura behind the hive core -->
    <div v-if="data.variant === 'start'" class="hive-aura"></div>
    <div v-if="data.variant === 'complete'" class="complete-aura"></div>

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
  if (props.data.variant === 'start') return '🐝';
  return props.data.label;
});
</script>

<style scoped>
.bookend-node {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  z-index: 1;
}

/* ── Hive core (START) — hexagonal organic center ── */
.bookend-node.start {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  font-size: 32px;
  background: radial-gradient(circle, rgba(245, 197, 66, 0.15) 0%, rgba(12, 18, 30, 0.95) 70%);
  border: 2px solid rgba(245, 197, 66, 0.4);
  color: #f5c542;
  box-shadow:
    0 0 30px rgba(245, 197, 66, 0.15),
    0 0 80px rgba(245, 197, 66, 0.05);
  animation: hiveCorePulse 3s ease-in-out infinite;
}

.hive-aura {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 200%;
  height: 200%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(245, 197, 66, 0.06) 0%, transparent 65%);
  pointer-events: none;
  animation: auraBreath 4s ease-in-out infinite;
  z-index: -1;
}

@keyframes hiveCorePulse {
  0%, 100% {
    box-shadow: 0 0 20px rgba(245, 197, 66, 0.12), 0 0 60px rgba(245, 197, 66, 0.04);
    border-color: rgba(245, 197, 66, 0.35);
  }
  50% {
    box-shadow: 0 0 40px rgba(245, 197, 66, 0.25), 0 0 100px rgba(245, 197, 66, 0.08);
    border-color: rgba(245, 197, 66, 0.6);
  }
}

@keyframes auraBreath {
  0%, 100% { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
}

/* ── End node ── */
.bookend-node.end {
  width: 90px;
  height: 50px;
  border-radius: 25px;
  font-size: 10px;
  background: rgba(12, 12, 30, 0.9);
  border: 1.5px solid rgba(138, 138, 245, 0.25);
  color: rgba(138, 138, 245, 0.6);
  box-shadow: 0 0 12px rgba(138, 138, 245, 0.06);
}

/* ── Complete node ── */
.bookend-node.complete {
  width: 100px;
  height: 60px;
  border-radius: 30px;
  font-size: 11px;
  background: radial-gradient(circle, rgba(76, 175, 80, 0.1) 0%, rgba(10, 20, 12, 0.95) 70%);
  border: 2px solid rgba(76, 175, 80, 0.5);
  color: #6ecf6e;
  box-shadow: 0 0 20px rgba(76, 175, 80, 0.15);
  animation: completeGlow 2s ease-in-out infinite;
}

.complete-aura {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 200%;
  height: 200%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(76, 175, 80, 0.05) 0%, transparent 65%);
  pointer-events: none;
  z-index: -1;
}

@keyframes completeGlow {
  0%, 100% { box-shadow: 0 0 15px rgba(76, 175, 80, 0.1); }
  50% { box-shadow: 0 0 30px rgba(76, 175, 80, 0.25); }
}

/* ── Failed node ── */
.bookend-node.failed {
  width: 100px;
  height: 60px;
  border-radius: 30px;
  font-size: 11px;
  background: rgba(25, 10, 10, 0.95);
  border: 2px solid rgba(244, 67, 54, 0.5);
  color: #f56a6a;
  box-shadow: 0 0 16px rgba(244, 67, 54, 0.15);
}

.bookend-label {
  pointer-events: none;
  position: relative;
  z-index: 2;
}
</style>
