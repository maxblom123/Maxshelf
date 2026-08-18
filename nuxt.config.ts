// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // Global stylesheet — currently just the Safari/iOS scroll-bounce fix
  // (overscroll-behavior on html/body). Has to be registered here, not
  // written into any individual page's scoped <style> block, since
  // scoped CSS can't reach html/body at all — they're outside the Vue
  // app root, so a scoped rule targeting them would silently do nothing
  // no matter which page it lived in.
  css: ['~/assets/css/main.css'],

  // Binds the dev server to all network interfaces (0.0.0.0), not just
  // localhost — this is what actually makes `npm run dev` reachable
  // from another device on the same network (phone, tablet, etc.),
  // printing a real "Network:" URL instead of "use --host to expose".
  //
  // Set here rather than relying on `npm run dev -- --host` because
  // that CLI flag wasn't reaching Nuxt at all — npm itself intercepted
  // it ("npm warn Unknown cli config '--host'") instead of forwarding
  // it to the underlying `nuxt dev` command, which is a known npm
  // argument-parsing quirk on some versions/platforms, not something
  // wrong with this project's setup. Configuring it here sidesteps that
  // entirely: `npm run dev` alone now always exposes the network URL,
  // no extra flags needed.
  devServer: {
    host: '0.0.0.0',
  },
})