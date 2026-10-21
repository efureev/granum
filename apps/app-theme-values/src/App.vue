<script setup lang="ts">
import type { GranumThemeState } from '@feugene/granum/runtime'
import { VdButton } from '@granum-fixtures/valued-ds/components/VdButton'
import { VdCard } from '@granum-fixtures/valued-ds/components/VdCard'
import { VdGroup } from '@granum-fixtures/valued-ds/components/VdGroup'
import { computed, ref } from 'vue'
import { manifest, themes } from './theme'

const state = ref<GranumThemeState>({ theme: themes.theme.id, mode: themes.mode })
themes.subscribe(next => (state.value = next))
const current = computed(() => manifest.themes.find(theme => theme.id === state.value.theme)!)
</script>

<template>
  <main class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
    <section class="flex flex-wrap items-center gap-2">
      <span class="font-bold">Тема:</span>
      <VdButton
        v-for="theme in manifest.themes"
        :key="theme.id"
        :data-theme-option="theme.id"
        :class="theme.id === state.theme ? 'font-bold' : 'op-60'"
        @click="themes.setTheme(theme.id)"
      >
        {{ theme.title }}<template v-if="theme.version">
          {{ theme.version }}
        </template>
      </VdButton>
    </section>
    <section class="flex flex-wrap items-center gap-2">
      <span class="font-bold">Режим:</span>
      <VdButton
        v-for="mode in current.modes"
        :key="mode.name"
        :data-mode-option="mode.name"
        :class="mode.name === state.mode ? 'font-bold' : 'op-60'"
        @click="themes.setMode(mode.name)"
      >
        {{ mode.title ?? mode.name }}
      </VdButton>
    </section>
    <VdCard data-card>
      <p>Карточка: фон и отступ — значения темы, а не пакета компонентов.</p>
      <VdGroup :items="['Один', 'Два', 'Три']" />
    </VdCard>
  </main>
</template>
