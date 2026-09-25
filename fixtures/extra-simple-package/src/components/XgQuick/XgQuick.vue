<script setup lang="ts">
import { XTest1 } from '@granum-fixtures/simple/components/XTest1'
</script>

<template>
  <div class="xg-quick">
    <XTest1>
      XTest1 1
    </XTest1>
    <!-- <XTestStyled class="text-styled p-5">комментарий: класс p-5 не извлекается</XTestStyled> -->
  </div>
</template>
