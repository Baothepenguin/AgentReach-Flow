import { createApp } from "../server/app";

let appPromise: Promise<{ app: any }> | null = null;

export default async function handler(req: any, res: any) {
  if (!appPromise) {
    appPromise = createApp();
  }
  const { app } = await appPromise;
  return app(req, res);
}

