<script setup lang="ts">
/*
 * Импорт из корневого бареля пакета — намеренно, а не из subpath компонента.
 * Барель реэкспортирует оба компонента, и только так видно работу
 * tree-shaking: `XxBadge` в бандл не попадает, хотя объявлен рядом.
 */
import { XxCard } from '@granum-fixtures/mini-ds'
</script>

<template>
  <!-- Один div и один компонент: всё, что окажется в дистрибутиве сверх
       этого, приехало из пакета и подлежит объяснению. -->
  <div class="mx-auto max-w-md p-6">
    <XxCard>
      Аудит дистрибутива
    </XxCard>
  </div>
</template>
