# Start-up and first-time setup screens

PNG exports of the start-up and first-time setup screens.

- `computer-1/`: the school server (Super Admin's computer)
- `computer-2/`: the accountant's computer

Where an image and a decision differ, the decision wins. Decisions are in `docs/DECISIONS.md` and the other files in `docs/`. Known differences:

## Computer 2

- **Find Computer 1:** there is no network search. The accountant types the server address and clicks Test connection. The screen then shows "Connected to MIKEY-SERVER, Mikey English Medium School", taken from `/health` (D21).
- **Get allowed:** the computer asks with `POST /api/v1/connection-requests` and repeats once a minute while pending. If the Super Admin declines, the screen shows "Declined" with an "Ask again" button (D20; ARCHITECTURE.md, Allowed computers).
- **Receipt printer:** there is no "Print a test receipt" here. Test printing is in the Accountant settings panel after sign-in.
- **Step numbers:** the rail numbers Which computer, Find Computer 1, Get allowed and Receipt printer 1 to 4. Ready has no number. Pages say "Step N of 4".
- **School logo:** the screens before sign-in use the logo shipped in the app (`apps/desktop/assets/school-logo.png`).

## Computer 1

- **Accountant's computer:** pending requests show Allow / Not this one. "Add a computer by IP address" is added as a manual fallback (D20). The note "The Windows firewall rule is added for you" is wrong: the installer creates one rule for the local subnet, and allowing a computer only adds it to the server's allow list.
- Computer 1's "Which computer is this?" and "Ready" screens have not been exported yet.
