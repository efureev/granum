<script setup lang="ts">
import { AtBox } from '@granum-fixtures/atoms/components/AtBox'
import { PlCard } from '@granum-fixtures/plain/components/PlCard'
</script>

<template>
  <!-- Линия правила приложения — у внутреннего блока: у края <main> она слилась бы с рамкой стенда. -->
  <main class="atom-pad-4">
    <div class="atom-pad-4 atom-hairline">
      <AtBox>
        <PlCard>
          Два словаря в одной сборке: рамка — правило пакета, линия под блоком — правило приложения
        </PlCard>
      </AtBox>
    </div>
  </main>
</template>
