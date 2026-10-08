import { z } from 'zod'
import { checkRateLimit, clearRateLimit, issueToken, verifyPin } from './_lib/auth.js'
import { HttpError, jsonBody, route } from './_lib/http.js'
import { describePrivateKeyProblem } from './_lib/private-key.js'

const loginSchema = z.object({
  pin: z.string().min(4, 'PIN 至少 4 碼').max(32),
})

export default route({
  /**
   * 伺服器設定健檢。只回傳「有沒有設好」與格式問題的說明，
   * 不包含任何環境變數的內容。
   */
  GET: async () => {
    const keyProblem = describePrivateKeyProblem(process.env.GOOGLE_PRIVATE_KEY)
    const checks = {
      pin: Boolean(process.env.APP_PIN_HASH && process.env.AUTH_SECRET),
      sheetId: Boolean(process.env.SHEET_ID),
      serviceAccountEmail: /@.+\.iam\.gserviceaccount\.com$/.test(
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '',
      ),
      privateKey: keyProblem === null,
    }

    return {
      configured: Object.values(checks).every(Boolean),
      checks,
      ...(keyProblem ? { hint: keyProblem } : {}),
    }
  },

  POST: async (req) => {
    checkRateLimit(req)
    const { pin } = loginSchema.parse(jsonBody(req))

    if (!verifyPin(pin)) {
      throw new HttpError('PIN 不正確', 401)
    }

    clearRateLimit(req)
    return issueToken()
  },
})
