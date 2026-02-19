// plugins/ping.js
module.exports = {
  name: "Ping",
  category: "tools",
  desc: "Quick sanity check",
  command: ["ping"],
  run: async ({ reply }) => reply("pong"),
};