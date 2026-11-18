# Nebula Privacy Policy

Nebula is a chat app.

Updated November 16, 2026.

There are two separate locks.

The first lock is on the device. The browser turns a message, a photo, or a video into ciphertext before the upload. That ciphertext is what gets saved. Reading it later takes a room key. The room key lives in the person’s vault, or, for a public server, in the invite.

The second lock is on the file. The account file, the friend list, the direct-message list, the server list, and the message file are sealed on disk with a key that sits next to the server (` .data-key `). The running server opens that seal so it can do its job. A copy of the file, without that key, stays scrambled. Opening the seal does not turn a device-locked message back into words. It only shows the record: who sent it, when, and the ciphertext.

## The vault

Signing up creates a vault in the browser. The vault is a small JSON object:

- A random 32-byte master. The server stores only the SHA-256 of those bytes. That hash is the proof that the recovery secret was right. The server never receives the master itself during sign-in.
- An ECDH P-256 key pair. The public half is saved on the account as `vaultPub`. The private half stays inside the vault and is what unwraps direct-message keys.
- Three maps, `servers`, `dms`, and `groups`. Each map holds the room keys this account has learned.

The whole vault is wrapped before it leaves the browser. The recovery secret (a passphrase, or a generated code) is stretched with PBKDF2-SHA256 for 150,000 rounds, and that key encrypts the vault with AES-GCM. The server stores the wrapped bytes, the salt, the master hash, the public key, and whether the secret is a passphrase or a code.

A recovery code is 16 characters from an alphabet that skips look-alike letters, shown in groups of four.

A second wrap exists only so the owner can look at the secret again. The recovery secret is encrypted with the account password, the same PBKDF2 and AES-GCM steps, and that blob is stored as `recoveryView`. The password is checked on the server before the blob is handed back. The browser decrypts it. The account file does not contain the secret in the clear. A secret saved before this wrap existed cannot be shown. Saving a new passphrase or code replaces the old one and stores a new wrap.

After a successful sign-in the browser keeps two things in local storage until sign-out: the unlocked vault, and the recovery secret. The secret is kept so that when this device learns a new room key it can wrap the vault again and upload the new copy. Sign-out deletes both. The next sign-in asks for the email, the password, and the recovery secret again.

## Sign-in

Sign-in is three checks, in order.

1. The person types an email and a password. The email is stored on the account in lowercase, and a slow scrypt hash of it is stored too (scrypt, N = 4096). The password is stored only as a scrypt hash (N = 16384). A matching email and password do not create a session.
2. The server returns a short-lived ticket and the wrapped vault. No messages are available yet. An older account that has never made a vault gets a one-time setup screen instead, and must pick a passphrase or a recovery code before anything opens.
3. The person types the recovery secret. The browser unwraps the vault locally. If the secret is wrong, the unwrap fails and nothing is sent that would open the account. If it works, the browser sends the SHA-256 of the master. The server compares that to the stored hash and only then issues a session token.

From then on, a request from an account with no vault hash is refused. Losing the recovery secret means the account does not open and the old messages stay scrambled. Changing the password replaces the password hash and still requires the recovery secret on the next sign-in. If this browser still has the secret, changing the password also re-wraps the copy used by the account page, so Show secret keeps working.

The account page hides the email behind an eye button. Other people receive an empty email field.

## A server message

Each server has one room key: 32 random bytes, created in the browser of the person who makes the server.

Sending text in a channel works like this.

1. The browser looks up `vault.servers[serverId]`.
2. If that slot is empty and this server is listed in Discover, the server object already includes the room key, and the browser saves it into the vault.
3. If the slot is still empty, the message is not sent. The person has to open an invite that contains the key.
4. The text is encrypted with AES-GCM under that room key. A fresh 12-byte IV is used each time. The saved string is `NEB2.` plus base64 of the IV and the ciphertext. The authentication tag rides at the end of the ciphertext, which is how WebCrypto lays out AES-GCM.
5. The server stores that string on the message. It does not decrypt it to enforce link or word filters. An edit is sealed the same way before the update is saved.

Reading is the reverse. The browser downloads the message, sees the `NEB2.` prefix, takes the room key from the vault, and decrypts. If the key is missing, the row stays locked and the text is blank.

Threads on a server use that same server key.

A person who joins with the invite can read the whole history while everyone else is offline. The history is already ciphertext plus the key they just saved. Nobody has to be online to hand them the key.

## Discover and the invite

The invite looks like `https://nebulaapp.space/the-server#k=` followed by the room key. The key in the link uses URL-safe characters: `+` and `/` become `-` and `_`, and the padding `=` is dropped. The browser restores the padding when it reads the link.

The part after `#` is a fragment. The browser does not send a fragment to the server when it requests the page. The page reads `#k=`, writes the key into the vault, uploads a freshly wrapped vault so the next device can learn it after a full sign-in, and clears the address bar.

Appear in Discover is off until the owner turns it on. While it is off, the room key is not stored on the server. The invite still carries the key after the #, and that is what a new member needs. Nebula Official is public, so its listing includes the key, and `https://nebulaapp.space/nebula` is not the full link.

A listed server is public. Anyone with the published link can read its history. The stored key also opens that history for whoever can read the server record. On startup, the server rewrites leftover plaintext in listed servers into `NEB2.` with that stored key, and it rewrites local chat files the same way. That pass does not touch profile pictures or server icons, and it does not touch old direct messages, because the server does not have those keys.

Turning Discover off deletes the room key from the server and stops publishing the link. Members who already saved the key keep reading. A new member needs an invite that still has `#k=`. New messages in that server are ciphertext the server cannot open.

## A direct message

A direct-message id is the two account ids, sorted and joined with a colon.

The first time someone sends, the browser does this.

1. It checks whether this device already has a key for that pair.
2. If not, it asks the server for the thread. If a wrap for this account is already there, the browser unwraps it with the vault’s private key and saves the room key.
3. If nobody has started the chat, the browser makes a new 32-byte room key. It wraps that key to each person’s `vaultPub`. The wrap is an ephemeral ECDH P-256 exchange plus AES-GCM: the server receives `{ eph, iv, ct }` for each person, and the room key is not in those fields in the clear. The server stores the wraps on the thread and does not replace wraps that are already there.
4. The text is then sealed with `NEB2.` under the room key, same as a channel message, and sent with the wraps.

The other person can be offline. When they next open the thread, their device unwraps its own copy, saves the key in the vault, and uploads a re-wrapped vault. After that, either person can read the history without the other one being online.

If the other account has no public key yet, the send fails. They have to set a recovery code or passphrase first, because there is no key to wrap to.

Group chats use the same steps. The first sender wraps the room key to every member who already has a public key.

## Photos and videos

A chat file is sealed before it is uploaded.

1. The browser builds a header: a 4-byte length, then JSON with the file name and the media type, then the raw bytes.
2. That whole buffer is encrypted with AES-GCM under the same room key as the text in that chat.
3. The uploaded bytes start with the four characters `NEB2`, then a 12-byte IV, then the ciphertext.
4. The upload is named `file`, marked encrypted, and the original name stays inside the sealed header. A readable thumbnail is not stored.
5. On screen, the browser downloads those bytes and opens them with the room key. Until that succeeds, the attachment is just a locked file.

Profile pictures, banners, and server icons are not chat files. They are stored in the open and stay visible.

Files can be up to 25 MB. When Cloudflare R2 is configured, the sealed upload is stored there. The bytes are already `NEB2` before that copy is made. Without R2, the sealed file stays on the machine running Nebula, and the message file’s disk seal still covers the record that points at it.

## Calls

A direct or group call leaves its record in that same thread. The browser seals a short note, `[[call:ring]]`, then replaces it with the length, a miss, or a decline. Nebula stores that note as `NEB2.` ciphertext beside the other messages. There is no separate call log of names. A ring that is still going is kept only in memory so the other person can pick up, and it is gone when the process stops.

Call audio and a shared screen go from one browser to the other with WebRTC. The media is encrypted by the peer connection. The server does not receive the audio or the screen.

The setup messages that connect the two browsers (the offer, the answer, and the network candidates) are sealed first. Each side derives an AES-GCM key from an ECDH exchange with the other person’s call key, encrypts the setup, and posts only that blob. The server holds it in memory long enough to hand it over. It does not open it, and it does not write it into the message history.

The server still knows who joined a call and when. The network path between the two devices is still visible to ngrok, the router, and the internet provider. Nebula does not write IP addresses into its own files. A session row stores the label **Signed-in session**, a time, and a SHA-256 of the login token. It does not store a computer name or a browser string.

## What we can see

After the disk seal is open, the running server can see:

- Usernames, which anyone in a server can also see.
- The saved email. Only the owner’s own account response includes it.
- The password hash and the email hash, not the password.
- The wrapped vault, the public key, and the password-wrapped recovery copy.
- Who is friends with whom, who is in a direct message, and who belongs to a server.
- That a message exists, who sent it, and when. The body is `NEB2.` ciphertext unless the server also has the room key.
- The room key of every server that is still listed in Discover, and therefore the history of those servers.
- Who is currently in a call. While a call is active, the running server temporarily holds a list of participating account IDs in memory. This allows Nebula to route incoming calls and deliver encrypted connection setup messages. The list is not written to disk and disappears when the call ends or the server restarts. The saved call record in the message thread is encrypted with `NEB2.` ciphertext. Nebula cannot read whether a call was missed, declined, or how long it lasted. Call audio, screen sharing, and connection setup messages are also encrypted. Nebula cannot access the audio or shared screen, but it can see who is currently ringing or participating in a call.

The running server cannot turn these back into words or pixels:

- A channel message, photo, or video in a server whose Discover switch is off, because that room key was deleted from the server.
- A direct message or a group message, because the server stored wraps, not the room key. Opening a wrap takes the private key inside the vault, and opening the vault takes the recovery secret.
- The recovery secret itself. The password-wrapped copy opens only after the account password checks out, and the vault wrap opens only with the recovery secret.

Three cases still reveal chats:

- A phone or browser that is already signed in has the unlocked vault in local storage until sign-out.
- A server listed in Discover can be read by joining the published link. The key is part of that listing on purpose.
- The page in the browser is what locks and unlocks chats. Replacing the published website replaces that page, so the new page can ask for the secret. A hash pinned to the old script does not stop the person who publishes the site.

## More information

Nebula does not sell users' personal data, and we do not operate as a data-broker or sell user information to advertisers.
Nebula is independently operated. We do not partner with, work on behalf of, or maintain affiliations with government agencies. Our platform is built around user privacy, and we do not provide government agencies with routine or direct access to private conversations.
We collect only the information necessary to operate accounts and provide the platform's features. Private message contents are encrypted before leaving the user's device, and we do not ordinarily possess the keys needed to read private conversations.
Your conversations are yours. Your privacy is not a product, and your personal information is not something we sell.

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/e1e93985-257f-4330-a12a-be42710f9e88" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/a2429a1e-cf0a-4b74-88c9-00be712183c5" />


