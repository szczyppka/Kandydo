import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// @serwist/next dev/build ide na webpack, nie Turbopack — patrz DECISIONS.md.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
};

export default withNextIntl(withSerwist(nextConfig));
