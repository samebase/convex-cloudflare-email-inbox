// The app Worker serves the built app. Mail goes to the inbox Worker that the
// setup stack uploads from the component (alchemy.run.ts).
export default {
  async fetch(request, env) {
    return await env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
