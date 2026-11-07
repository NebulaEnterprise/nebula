# Nebula

Discord-style chat. The interface is a Svelte app. The API is `server.js`.

## Run it

```bash
cd client
npm install
npm run dev
```

The dev app is at http://127.0.0.1:4178 and talks to the API on port 3850.

In another terminal, from this folder:

```bash
npm install express@4 cors nodemailer uuid
node server.js
```

`node server.js` serves the built site in `dist/` when that folder is present. Otherwise it serves `../frontend`.

## Build

```bash
cd client
npm run build
```

That writes `dist/`. Copy the contents of `dist/` into the frontend folder your live server uses, replace `server.js`, restart node, and hard-refresh.
