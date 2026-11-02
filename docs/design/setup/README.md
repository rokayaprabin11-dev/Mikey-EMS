# Start-up and first-time setup screens

JPEG exports of the start-up and first-time setup screens. The Computer 1 images are 1× exports and will be replaced by 2× exports.

- `computer-1/`: the school server (Super Admin's computer)
- `computer-2/`: the accountant's computer

Where an image and a decision differ, the decision wins. Decisions are in `docs/DECISIONS.md` and the other files in `docs/`. Known differences:

## Computer 2

- **Splash:** it shows the app's name, "Mikey EMS", because the school's name is not known before Computer 1 answers. It has two steps, "Opening the app" and "Connecting to Computer 1 at …". "Loading today's fees" is left off, because nothing can be loaded before sign-in. When Computer 1 cannot be used, the error panel says why ("Can't reach Computer 1 at …", or "Computer 1 is on, but its database has stopped."), with Try again, Copy error details and Change the server address, which opens setup.
- **Which computer:** "This is the school server, Computer 1" cannot be chosen yet and says "Not available in this version yet."
- **Find Computer 1:** there is no network search. The accountant types the server address and clicks Test connection. The screen then shows "Connected to MIKEY-SERVER, Mikey English Medium School", taken from `/health` (D21). The address is saved only when Continue is clicked after a test that worked.
- **Get allowed:** the computer asks with `POST /api/v1/connection-requests` and repeats once a minute while pending. Once allowed, it shows "Allowed at 10:04 AM", never who allowed it. If the Super Admin declines, the screen shows "Declined at …" with an "Ask again" button (D20; ARCHITECTURE.md, Allowed computers). A computer that was set up before but is no longer allowed starts here.
- **Receipt printer:** there is no "Print a test receipt" here. Test printing is under Printer in the account menu after sign-in, where the printer can be changed too. Printers have no "Windows default" tag, and none is chosen until the accountant picks one, because Electron does not say which printer is the default. When Windows has no printer at all, setup can still finish, and the Ready page says receipts open the Windows print window.
- **Step numbers:** the rail numbers Which computer, Find Computer 1, Get allowed and Receipt printer 1 to 4. Ready has no number. Pages say "Step N of 4".
- **School logo:** the screens before sign-in use the logo shipped in the app (`apps/desktop/assets/school-logo.png`).

## Computer 1

- **Accountant's computer:** pending requests show Allow / Not this one. "Add a computer by IP address" is added as a manual fallback (D20). The note "The Windows firewall rule is added for you" is wrong: the installer creates one rule for the local subnet, and allowing a computer only adds it to the server's allow list.
- Computer 1's "Which computer is this?" and "Ready" screens have not been exported yet.
