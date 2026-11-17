import { randomUUID } from "node:crypto";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "service-worker.js",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  disable: process.env.NODE_ENV === "development",
  // Offline HTML must reference the current build's hashed scripts.
  additionalPrecacheEntries: [{ url: "/_offline/", revision: randomUUID() }],
});

export default withSerwist({
  trailingSlash: true,
  async headers() {
    return [
      {
        source: "/song/:slug*",
        headers: [
          /*
            s-maxage=2419200, // Set the max age of the cached content to a month (28 days)
            stale-while-revalidate=1209600, // Stale whhile revalidate for a fortnight
            stale-if-error=31536000`, // If an error occurs with the revalidation of the cached content, then the cached content will be served for a maximum of a year (365 days)
          */
          {
            key: "Cache-Control",
            value:
              "public,s-maxage=2419200,stale-while-revalidate=1209600,stale-if-error=31536000",
          },
          {
            key: "X-Frame-Options",
            value: "ALLOW-FROM https://teams.microsoft.com/",
          },
        ],
      },
    ];
  },
});
