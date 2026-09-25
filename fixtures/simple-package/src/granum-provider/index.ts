import { defineGranumProvider } from '@feugene/granum/contract'
import { xGroupAOneConfig } from '../components/groupA/XGroupAOne/config.ts'
import { xGroupATwoConfig } from '../components/groupA/XGroupATwo/config.ts'
import { xNestedReverseConfig } from '../components/reverses/XNestedReverse/config.ts'
import { xNestedConfig } from '../components/XNested/config.ts'
import { xTest1Config } from '../components/XTest1/config.ts'
import { xTestStyledConfig } from '../components/XTestStyled/config.ts'
import { xTokenizedConfig } from '../components/XTokenized/config.ts'

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
    xTest1Config,
    xTestStyledConfig,
    xTokenizedConfig,
    xNestedConfig,
    xNestedReverseConfig,
    xGroupAOneConfig,
    xGroupATwoConfig,
  ],
})

export default simpleProvider
