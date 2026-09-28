<script setup lang="ts">
/*
 * Импорт из `virtual:granum/components`, а не из пакета: это и есть предмет
 * стенда. Модуль реэкспортирует оба компонента селекции, приложение берёт
 * один — значит второй обязан исчезнуть из бандла.
 */
import { XxCard } from 'virtual:granum/components'
</script>

<template>
  <!-- `p-[var(--xxx-space-2)]` — класс, который есть и у XxCard: на нём видно
       поле `classes.app` отчёта, ради которого оно и заведено. -->
  <div class="mx-auto max-w-md p-[var(--xxx-space-2)]">
    <XxCard>
      Канал JS
    </XxCard>
  </div>
</template>
