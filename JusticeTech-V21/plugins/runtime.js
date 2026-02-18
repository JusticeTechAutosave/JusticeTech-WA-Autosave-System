// plugins/runtime.js
module.exports = {
  name: "Runtime",
  category: "tools",
  desc: "Shows bot uptime",
  command: ["runtime"],
  run: async ({ sock, m }) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    await sock.sendMessage(
      m.chat,
      {
        text:
          `*Runtime Info*\n\n` +
          `⏰ Hours: ${hours}\n` +
          `⏰ Minutes: ${minutes}\n` +
          `⏰ Seconds: ${seconds}`,
      },
      { quoted: m }
    );
  },
};