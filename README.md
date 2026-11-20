# Time Machine

A mobile alarm clock starter with an Expo React Native app and a small Python/FastAPI backend. Alarm times use the phone's automatically detected local time zone.

The app is named **Time Machine** and includes a light/dark theme switch in the top-right corner. Your selected theme is saved on the device.

## Start the app

Install Node.js 22.13+ and npm, then from this folder:

```bash
npm install
npx expo start
```

Open the QR code in Expo Go. Local notifications are scheduled on the phone, so alarms do not depend on the backend being online. iOS and Android notification settings still control whether alerts and sounds are allowed. For reliable background behavior, build and test a development or release build on a real device.

## Start the Python backend

In another terminal:

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API is at `http://localhost:8000` and interactive docs are at `/docs`. If using a phone, set `EXPO_PUBLIC_API_URL` in the project root `.env` to your computer's LAN address, such as `http://192.168.1.10:8000`, then restart Expo. The starter app keeps alarms on-device and syncs alarm changes to the backend when reachable.

## Notes

- One-time alarms that are set for an earlier time today are scheduled for tomorrow.
- Repeating alarms use the days selected in the editor.
- Long-press an alarm card to delete it.
- This is a notification-based alarm starter; mobile operating systems may limit alarm presentation or exact timing depending on permissions and power settings.
