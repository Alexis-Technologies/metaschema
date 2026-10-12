<script setup lang="ts">
import { computed } from 'vue';
import baseline from '../../../../bench/baseline.json';
import compare from '../../../../bench/results/compare.json';
import releases from '../../../../bench/results/releases.json';
import size from '../../../../bench/results/size.json';
import {
  coldStartModel,
  engineModel,
  machineCaption,
  releasesCaption,
  sizeModel,
  speedupModel,
} from '../../../../bench/report/model.mjs';
import BenchBars from './BenchBars.vue';

const props = defineProps<{ chart: 'coldstart' | 'size' | 'engine' | 'speedup' }>();

const figure = computed(() => {
  switch (props.chart) {
    case 'coldstart':
      return { model: coldStartModel(compare), caption: machineCaption(compare.machine) };
    case 'size':
      return { model: sizeModel(size), caption: null };
    case 'speedup':
      return { model: speedupModel(releases), caption: releasesCaption(releases) };
    default:
      return {
        model: engineModel(baseline),
        caption: `pnpm bench, bench/baseline.json · Node ${baseline.node} · ${baseline.date.slice(0, 10)}`,
      };
  }
});
</script>

<template>
  <BenchBars :model="figure.model" :caption="figure.caption" />
</template>
