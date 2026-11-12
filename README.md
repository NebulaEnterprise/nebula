# Nebula

Nebula is a chat app. This is its privacy policy.

## Privacy policy

Updated November 11, 2026.

### Emails

The address is not written down. Nebula keeps a slow hash and checks it when someone types that address to log in or change it. 

### Passwords

The password itself is not stored. New passwords use a slow hash. 

### IP addresses

Nebula does not record them. The connection address is still visible to ngrok, the router, and the internet provider.

### Devices

Sessions do not store a computer name or a browser string. The list shows **Signed-in session** and a time. The login key in the file is a hash, so the file is not a set of live logins.

### Usernames 

Usernames remain in the file and anyone in a server can see them.

### Messages

messages are encrypted on the device before it reaches the server. The server stores the sealed message, not the words. Files, photos, videos, and polls are not encrypted. 

### Calls

Call audio and screen sharing are encrypted between the people on the call. The setup that connects them is sealed with the same keys as messages, and the server only carries that sealed setup. It cannot read the setup or hear the call. The server still knows who joined a call and when. The network between those devices carries encrypted audio, and the connection address is still visible to ngrok, the router, and the internet provider.

### Summary. The data people send on Nebula is encrypted. Message text is encrypted on the device, and so are calls and screen sharing, so the server cannot read the words or hear the call. Emails and passwords are not stored in a form that can be read. IP addresses and device details are not kept. A copy of the server files does not keep email addresses, password text, IP addresses, or computer and browser names. Usernames stay, because people have to be able to find and see each other.
