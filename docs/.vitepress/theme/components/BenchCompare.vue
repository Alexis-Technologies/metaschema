<script setup lang="ts">
import { computed, ref } from 'vue';
import compare from '../../../../bench/results/compare.json';
import { compareCaption, compareGroups, compareModel } from '../../../../bench/report/model.mjs';
import BenchBars from './BenchBars.vue';
import Segmented from './Segmented.vue';

const props = withDefaults(defineProps<{ group?: string; mode?: string }>(), {
  group: 'nested',
  mode: 'parseStrict',
});

const groups = compareGroups(compare);
const group = ref(props.group);
const mode = ref(props.mode);
const current = computed(() => groups.find((item) => item.id === group.value) ?? groups[0]);
const modes = computed(() => current.value.modes.map((item) => ({ id: item.id, title: item.id })));
const scenario = computed(() => {
  const found = current.value.modes.find((item) => item.id === mode.value);
  return found ? found.scenario : current.value.scenario;
});

// Log by default: the results span three orders of magnitude, so on a linear
// axis the slow rows would be invisible. The toggle shows the other view.
const scale = ref('log');
const scales = [
  { id: 'log', title: 'Log' },
  { id: 'linear', title: 'Linear' },
];
const model = computed(() => compareModel(compare, scenario.value, scale.value));
const caption = compareCaption(compare);
</script>

<template>
  <BenchBars :model="model" :caption="caption">
    <template #controls>
      <div class="ms-controls">
        <Segmented v-model="group" label="Scenario" :items="groups" />
        <Segmented v-model="scale" label="Axis scale" :items="scales" />
        <Segmented v-if="modes.length" v-model="mode" label="Mode" :items="modes" />
      </div>
    </template>
  </BenchBars>
</template>

<style scoped>
.ms-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
</style>
