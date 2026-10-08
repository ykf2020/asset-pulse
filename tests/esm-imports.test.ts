import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * 守住一個踩過的坑：
 *
 * package.json 有 `"type": "module"`，Vercel 會把 api/ 底下的檔案**逐檔轉譯**成
 * ESM 而不是打包起來。Node 原生的 ESM 解析器不會自動補副檔名，所以
 * `import './_lib/auth'` 在部署後會直接 ERR_MODULE_NOT_FOUND，整支 function
 * 掛掉（FUNCTION_INVOCATION_FAILED），連錯誤訊息都回不出來。
 *
 * 本地跑 vite / vitest 時是 Vite 的解析器在處理，它會自動補，所以這個問題
 * **只會在部署後出現** —— 這就是為什麼需要一個純文字層級的檢查。
 */

const RELATIVE_IMPORT = /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g

function tsFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const relative = join(dir, name)
    if (statSync(join(ROOT, relative)).isDirectory()) return tsFiles(relative)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [relative] : []
  })
}

describe('Node 原生 ESM 相容性', () => {
  // api/ 會被 Vercel 當成 function，shared/ 被它們 import，兩邊都要守
  const files = [...tsFiles('api'), ...tsFiles('shared')]

  it('掃得到檔案（避免這個測試因為路徑錯了而空轉通過）', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files)('%s 的相對 import 都有寫副檔名', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    const offenders = [...source.matchAll(RELATIVE_IMPORT)]
      .map((m) => m[1]!)
      .filter((specifier) => !specifier.endsWith('.js'))

    expect(offenders, `${file} 這些 import 少了 .js：${offenders.join(', ')}`).toEqual([])
  })

  it('api/ 底下沒有測試檔（會被 Vercel 部署成公開端點）', () => {
    function allFiles(dir: string): string[] {
      return readdirSync(join(ROOT, dir)).flatMap((name) => {
        const relative = join(dir, name)
        return statSync(join(ROOT, relative)).isDirectory() ? allFiles(relative) : [relative]
      })
    }
    expect(allFiles('api').filter((f) => f.includes('.test.'))).toEqual([])
  })
})
