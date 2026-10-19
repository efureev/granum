<script setup lang="ts">
import { XgQuick } from '@granum-fixtures/extra-simple/components/XgQuick'
import { XhCard } from '@granum-fixtures/heavy/components/XhCard'
import { XTokenized } from '@granum-fixtures/simple/components/XTokenized'
import { inject } from 'vue'
import { activeModeKey } from './theme'

/**
 * Режим приходит извне: на сервере это выбор из запроса, в браузере — контроллер
 * над DOM. Разметка от источника не зависит, поэтому серверный HTML и первый
 * клиентский кадр совпадают.
 */
const mode = inject(activeModeKey)!
</script>

<template>
  <main class="mx-auto flex max-w-2xl flex-col gap-6 p-8">
    <header class="flex items-center gap-3">
      <span class="font-bold">Режим:</span>
      <button
        v-for="name in mode.list"
        :key="name"
        type="button"
        class="rounded border px-3 py-1"
        :class="name === mode.name ? 'font-bold' : 'op-60'"
        data-mode-button
        @click="mode.set(name)"
      >
        {{ name }}
      </button>
      <span class="ml-auto" data-active-mode>{{ mode.name }}</span>
    </header>

    <!-- Компонент с собственным CSS плюс его донор из другого пакета. -->
    <XgQuick>
      Кросс-пакетная зависимость
    </XgQuick>

    <!-- Токены темы из данных провайдера. -->
    <XhCard>
      Карточка на токенах темы
    </XhCard>

    <!-- Токены темы, объявленные структурно. -->
    <div class="flex items-center gap-4">
      <XTokenized class="h-12 w-20 shrink-0 rounded-lg" />
      <span>XTokenized — фон из структурного токена темы</span>
    </div>

    <!--
      Класс, который есть только в разметке приложения: обрезка токенов обязана
      сохранить токен, до которого достаёт только отсюда.
    -->
    <p class="text-[var(--x-tokenized)]">
      Токен приложения
    </p>
  </main>
</template>
