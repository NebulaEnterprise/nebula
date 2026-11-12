# Nebula

Nebula is a chat app. This is its privacy policy.

## Privacy policy

Updated November 11, 2026.

A copy of the server files does not keep email addresses, password text, IP addresses, or computer and browser names. Usernames stay, because people have to be able to find and see each other.

### Emails

The address is not written down. Nebula keeps a slow hash and checks it when someone types that address to log in or change it. The Account page says **Not stored**. Someone who already knows an address can still check whether it matches. Gmail still has any address a verification mail was sent to.

### Passwords

The password itself is not stored. New passwords use a slow hash. An older account still has the faster hash until that person logs in once. The next successful login replaces it.

### IP addresses

Nebula does not record them. The connection address is still visible to ngrok, the router, and the internet provider.

### Devices

Sessions do not store a computer name or a browser string. The list shows **Signed-in session** and a time. The login key in the file is a hash, so the file is not a set of live logins. A phone or computer that is already signed in can still open the chats that device can decrypt.

### Usernames and direct messages

Usernames remain in the file, and anyone in a server can see them. Who has a direct message is still in `dms.json` for anyone who also has the `.data-key` file next to `server.js`.

### Messages

New message text is encrypted on the device before it reaches the server. The server stores the sealed message, not the words. Files, photos, videos, and polls are not encrypted. A device that can decrypt a chat can still read it.

### Calls

Call audio and screen sharing are encrypted between the people on the call. The setup that connects them is sealed with the same keys as messages, and the server only carries that sealed setup. It cannot read the setup or hear the call. The server still knows who joined a call and when. A phone or computer on the call can still hear it. The network between those devices carries encrypted audio, and the connection address is still visible to ngrok, the router, and the internet provider.
