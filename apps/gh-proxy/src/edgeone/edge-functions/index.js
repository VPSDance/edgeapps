import { renderLanding } from '@edgeapps/core/landing';

export default async function onRequest(context) {
  return renderLanding(context?.env);
}
