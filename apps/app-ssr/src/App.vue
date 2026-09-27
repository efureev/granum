<script setup lang="ts">
import { XgQuick } from '@granum-fixtures/extra-simple/components/XgQuick'
import { XhCard } from '@granum-fixtures/heavy/components/XhCard'
import { XTokenized } from '@granum-fixtures/simple/components/XTokenized'
import { inject } from 'vue'
import { activeThemeKey } from './theme'

/**
 * Тема приходит извне: на сервере это выбор из запроса, в браузере — контроллер
 * над DOM. Разметка от источника не зависит, поэтому серверный HTML и первый
 * клиентский кадр совпадают.
 */
const theme = inject(activeThemeKey)!
</script>

<template>
  <main class="mx-auto flex max-w-2xl flex-col gap-6 p-8">
    <header class="flex items-center gap-3">
      <span class="font-bold">Тема:</span>
      <button
        v-for="name in theme.list"
        :key="name"
        type="button"
        class="rounded border px-3 py-1"
        :class="name === theme.name ? 'font-bold' : 'op-60'"
        data-theme-button
        @click="theme.set(name)"
      >
        {{ name }}
      </button>
      <span class="ml-auto" data-active-theme>{{ theme.name }}</span>
    </header>

    <!-- Компонент с собственным CSS плюс его донор из другого пакета. -->
    <XgQuick>
      Кросс-пакетная зависимость
    </XgQuick>

    <!-- Токены темы из CSS-файлов провайдера. -->
    <XhCard>
      Карточка на токенах темы
    </XhCard>

    <!-- Токены темы, объявленные структурно. -->
    <XTokenized />

    <!--
      Класс, который есть только в разметке приложения: обрезка токенов обязана
      сохранить токен, до которого достаёт только отсюда.
    -->
    <p class="text-[var(--x-tokenized)]">
      Токен приложения
    </p>
  </main>
</template>
