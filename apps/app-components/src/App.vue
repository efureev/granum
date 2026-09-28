<script setup lang="ts">
/*
 * Импорт из `virtual:granum/components`, а не из пакета: это и есть предмет
 * стенда. Модуль реэкспортирует оба компонента селекции, приложение берёт
 * один — значит второй обязан исчезнуть из бандла.
 */
import { XxCard } from 'virtual:granum/components'
</script>

<template>
  <div class="mx-auto max-w-md p-6">
    <XxCard>
      Канал JS
    </XxCard>
  </div>
</template>
