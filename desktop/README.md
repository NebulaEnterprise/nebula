# Nebula desktop

The desktop app is Nebula’s own window around the live site at [nebulaspace.lol](https://www.nebulaspace.lol/). The title bar uses the Nebula logo and the same dark colors as the app. Chat, voice, friends, settings, and everything else on the site are the same app. When the website is updated from this repo, the desktop window picks up the new page on its own. You do not reinstall it for a site update.

A reload waits until you leave a call. The window icon is the Nebula logo.

## Run it

From this folder:

```bash
npm install
npm start
```

On Windows, that opens Nebula with the logo in the taskbar. Sign in once; the login stays on this computer.

## Installer

On the computer you want the installer for:

```bash
npm install
npm run dist
```

Windows builds an installer and a portable `Nebula.exe` in `desktop/dist`. Those files are not committed. The installed app still loads the live site, so later site updates show up without building again. Upload each new portable file to the GitHub release as `Nebula.exe`. The home page Download button always uses that file.
