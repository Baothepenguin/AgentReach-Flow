import { createRequire } from "module";

const require = createRequire(import.meta.url);

let appPromise: Promise<{ app: any }> | null = null;

function getAppPromise(): Promise<{ app: any }> {
  if (!appPromise) {
    // Load the bundled CJS app to avoid Node ESM relative import resolution issues on Vercel.
    const { createApp } = require("../dist/app.cjs");
    appPromise = createApp();
  }
  return appPromise!;
}

export default async function handler(req: any, res: any) {
  const { app } = await getAppPromise();
  return app(req, res);
}
