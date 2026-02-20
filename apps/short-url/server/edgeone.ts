// EdgeOne Pages entry point
import app from './app';
// @ts-ignore - core package exports JS module
import { createEdgeOneHandler } from '@edgeapps/core/adapters/edgeone';

const handler = createEdgeOneHandler(app, {
  requiredBindings: ['SHORT_URL_KV']
});

export default async function onRequest(context: any) {
  return handler(context);
}
