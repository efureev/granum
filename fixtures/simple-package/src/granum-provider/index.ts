import { defineGranumProvider } from '@feugene/granum/contract'
// <granum:components:imports>
import { xGroupAOneConfig } from '../components/groupA/XGroupAOne/config.ts'
import { xGroupATwoConfig } from '../components/groupA/XGroupATwo/config.ts'
import { xNestedConfig } from '../components/XNested/config.ts'
import { xNestedReverseConfig } from '../components/reverses/XNestedReverse/config.ts'
import { xTest1Config } from '../components/XTest1/config.ts'
import { xTestStyledConfig } from '../components/XTestStyled/config.ts'
import { xTokenizedConfig } from '../components/XTokenized/config.ts'
// </granum:components:imports>

export const PROVIDER_ID = '@granum-fixtures/simple'

/**
 * Провайдер фикстуры. Тем на уровне пакета нет: токены живут в компонентах
 * (`XTokenized`). Объект нужен только сборке (`vite.config.ts`) — приложение
 * читает `granum.manifest.json`.
 */
export const simpleProvider = defineGranumProvider({
  id: PROVIDER_ID,
  contractVersion: 1,
  components: [
    // <granum:components:registry>
    xGroupAOneConfig,
    xGroupATwoConfig,
    xNestedConfig,
    xNestedReverseConfig,
    xTest1Config,
    xTestStyledConfig,
    xTokenizedConfig,
    // </granum:components:registry>
  ],
})

export default simpleProvider
