// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // This app has a tiny, stable route table. Shipping it with the initial
  // document removes the extra /__manifest request during auth-page
  // navigation and keeps public routing independent from auth middleware.
  routeDiscovery: { mode: "initial" },
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
