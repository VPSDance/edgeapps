// Cloudflare Pages entry point
import app from './app';
// @ts-ignore
import { createCloudflareHandler } from '@edgeapps/core/adapters/cloudflare';

export default createCloudflareHandler(app);
