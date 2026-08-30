import type { MetadataRoute } from 'next'

/**
 * An internal operations app. There is nothing here for a crawler, and the
 * login page is not a landing page.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: '/' }] }
}
