import { z } from 'zod'
import { checkRateLimit, clearRateLimit, issueToken, verifyPin } from './_lib/auth.js'
import { HttpError, jsonBody, route } from './_lib/http.js'

const loginSchema = z.object({
  pin: z.string().min(4, 'PIN 至少 4 碼').max(32),
})

export default route({
  /** 伺服器設定健檢，給 PIN 畫面提示用 */
  GET: async () => ({
    configured: Boolean(
      process.env.APP_PIN_HASH &&
        process.env.AUTH_SECRET &&
        process.env.SHEET_ID &&
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
        process.env.GOOGLE_PRIVATE_KEY,
    ),
  }),

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
