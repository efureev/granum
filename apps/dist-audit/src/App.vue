<script setup lang="ts">
/*
 * Компонент — из своего подпути: по нему granum видит, что выбрано. Импорт
 * компонента из корня пакета guard отвергает — корень тянет весь пакет.
 */
import { XxCard } from '@granum-fixtures/mini-ds/components/XxCard'
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
