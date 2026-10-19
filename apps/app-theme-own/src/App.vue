<script setup lang="ts">
import { TcChart } from '@granum-fixtures/themed-companion/components/TcChart'
import { TdButton } from '@granum-fixtures/themed-ds/components/TdButton'
import { TdCard } from '@granum-fixtures/themed-ds/components/TdCard'
import { ref } from 'vue'
import { themes } from './theme'

const current = ref(themes.mode)
themes.subscribe(mode => (current.value = mode))
</script>

<template>
  <main class="mx-auto flex max-w-2xl flex-col gap-6 p-8">
    <header class="flex items-center gap-3">
      <span class="font-bold">{{ themes.theme.title }}:</span>
      <TdButton v-for="mode in themes.modes()" :key="mode.name" :class="mode.name === current ? 'font-bold' : 'op-60'" @click="themes.setMode(mode.name)">
        {{ mode.title ?? mode.name }}
      </TdButton>
    </header>
    <TdCard>
      Карточка: отступ из токена компонента для темы
      <span class="dark:underline">подчёркнут в тёмных режимах</span>.
    </TdCard>
    <TcChart>График спутника</TcChart>
  </main>
</template>
