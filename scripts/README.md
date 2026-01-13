# Scripts

## test-websocket.js

Test script for verifying WebSocket connectivity to My Leviton.

### Usage

```bash
node scripts/test-websocket.js your@email.com
```

The script will:
1. Authenticate with your My Leviton account
2. Connect to the WebSocket server
3. Subscribe to your devices
4. Listen for real-time updates for 15 seconds

### Example Output

```
My Leviton WebSocket Test

Password: 
[12:34:56.789] INFO: Authenticating...
[12:34:57.123] OK: Login successful
[12:34:57.456] OK: Found 10 device(s)
[12:34:57.789] WS: Connecting...
[12:34:58.012] WS: Connected, authenticating...
[12:34:58.234] OK: Authenticated
[12:34:58.456] WS: Subscribing to 10 device(s)...
[12:34:58.678] INFO: Listening for updates (15 seconds)...
[12:34:58.890] INFO: Try toggling a device in the My Leviton app
[12:35:02.123] OK: Device update: 12345 - {"power":"ON","brightness":100}
[12:35:13.456] INFO: Test complete

✓ WebSocket connection successful
```

### Troubleshooting

If the test fails:
1. Verify your credentials work in the My Leviton app
2. Check your network allows WebSocket connections
3. Try again - transient network issues can cause failures
