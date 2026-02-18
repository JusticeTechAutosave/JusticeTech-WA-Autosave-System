// settings/config.js
const config = {
  // Developer / Owner control
  // Put your number here (digits only). This allows you to run .approve / .linkgoogle on any deployed bot.
  ownerNumber: "2349032578690",

  // Optional: allow multiple developer numbers
  ownerNumbers: ["2349032578690"],

  // keep your existing fields
  owner: "-",          // (legacy field in your base; not used by new owner check)
  botNumber: "-",      // (optional)
  setPair: "JusticeTech",

  // thumbnail should be a direct image url (imgur album links often fail)
  // if you can, use a direct png/jpg link
  thumbUrl: "https://imgur.com/a/dGWBv6v",

  session: "sessions",

  status: {
    public: true,
    terminal: true,
    reactsw: false
  },

  message: {
    owner: "no, this is for owners only",
    group: "this is for groups only",
    admin: "this command is for admin only",
    private: "this is specifically for private chat"
  },

  mess: {
    owner: "This command is only for the bot owner!",
    done: "Mode changed successfully!",
    error: "Something went wrong!",
    wait: "Please wait..."
  },

  settings: {
    title: "JusticeTech Autosave Bot System",
    packname: "JusticeTech",
    description: "Your most effective Autosave bot",
    author: "https://www.github.com/JusticeTechAutosave",
    footer: "𝗍𝖾𝗅𝖾𝗀𝗋𝖺𝗆: @justicetechie"
  },

  newsletter: {
    name: "JusticeTech Autosave Bot System",
    id: "0@newsletter"
  },

  api: {
    baseurl: "https://apis.k0mraidhost.name.ng/",
    apikey: "debrajzero"
  },

  sticker: {
    packname: "Simple WA Base Bot",
    author: "WA-BASE"
  }
};

module.exports = config;

// IMPORTANT: do NOT hot-reload config with fs.watchFile.
// It can cause duplicate listeners/replies in WhatsApp bots.
// If you really want reload behavior, restart the process instead.