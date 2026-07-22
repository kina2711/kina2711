import { generateTelemetrySvg } from "../.github/scripts/generate-profile-dashboard.mjs";

export default {
  async fetch() {
    try {
      const svg = await generateTelemetrySvg();
      return new Response(svg, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, no-cache, max-age=0, must-revalidate",
          "Vercel-CDN-Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      const message = String(error?.message || error).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const fallback = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="180" viewBox="0 0 1200 180"><rect width="1200" height="180" fill="#070C14"/><text x="40" y="68" fill="#F5B02E" font-family="monospace" font-size="24" font-weight="700">RABBIT TELEMETRY // DEGRADED MODE</text><text x="40" y="108" fill="#94A3B8" font-family="monospace" font-size="14">The live signal is temporarily unavailable. Static telemetry remains in the repository.</text><text x="40" y="138" fill="#F2712B" font-family="monospace" font-size="12">${message}</text></svg>`;
      return new Response(fallback, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  },
};
