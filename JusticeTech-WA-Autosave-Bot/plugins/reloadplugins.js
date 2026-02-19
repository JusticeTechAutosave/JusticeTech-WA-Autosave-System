// plugins/reloadplugins.js
module.exports = {
  name: "ReloadPlugins",
  category: "core",
  desc: "Reload all plugins without restarting the bot",
  command: ["rplugins", "rplug"],
  ownerOnly: true,

  run: async ({ reply }) => {
    if (typeof global.loadPlugins !== "function") {
      return reply("❌ Reload function not available. Use .reloadplugins instead.");
    }
    const meta = global.loadPlugins();
    const errText = meta.errors?.length ? `\n\nErrors:\n- ${meta.errors.join("\n- ")}` : "";
    return reply(`✅ Plugins reloaded.\nLoaded: ${meta.count}\nTime: ${meta.loadedAt}${errText}`);
  },
};
