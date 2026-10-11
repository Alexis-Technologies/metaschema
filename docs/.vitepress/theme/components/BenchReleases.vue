<script setup lang="ts">
import { computed, ref } from 'vue';
import releases from '../../../../bench/results/releases.json';
import {
  releaseModel,
  releaseScenarios,
  releasesCaption,
} from '../../../../bench/report/model.mjs';
import BenchBars from './BenchBars.vue';
import Segmented from './Segmented.vue';

const props = withDefaults(defineProps<{ scenario?: string }>(), { scenario: 'nested-valid' });

const scenarios = releaseScenarios(releases).map((item: any) => ({
  id: item.id,
  title: item.title.replace(/^check — /, '').replace(/ struct/, ''),
}));
const current = ref(props.scenario);
const model = computed(() => releaseModel(releases, current.value));
const caption = releasesCaption(releases);
</script>

<template>
  <BenchBars :model="model" :caption="caption">
    <template #controls>
      <div class="ms-controls">
        <Segmented v-model="current" label="Scenario" :items="scenarios" />
      </div>
    </template>
  </BenchBars>
</template>

<style scoped>
.ms-controls {
  margin-bottom: 1rem;
}
</style>
