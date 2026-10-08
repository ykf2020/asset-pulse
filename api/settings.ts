import { z } from 'zod'
import { requireAuthAll } from './_lib/auth'
import { jsonBody, route } from './_lib/http'
import { loadTables, readSettings, writeSettings } from './_lib/store'

const patchSchema = z.object({
  stale_days: z.number().int().min(1).max(365).optional(),
  review_weekday: z.number().int().min(0).max(6).optional(),
})

export default route(
  requireAuthAll({
    GET: async () => {
      const { settings } = await loadTables(['settings'])
      return { settings: readSettings(settings) }
    },

    PATCH: async (req) => {
      const patch = patchSchema.parse(jsonBody(req))
      const { settings } = await loadTables(['settings'])
      await writeSettings(settings, patch)

      const { settings: fresh } = await loadTables(['settings'])
      return { settings: readSettings(fresh) }
    },
  }),
)
